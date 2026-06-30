import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App.svelte";
import { mountUsageApp } from "./mount.js";
import type { UsageConversationView, UsageSparkline, UsageUiClient } from "@tangent/usage-ui-data";

afterEach(() => cleanup());

describe("usage svelte app", () => {
  it("opens in browse mode with date and a per-conversation flame graph", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    const card = await screen.findByRole("button", { name: /Implement UI/ });
    expect(card).toHaveClass("session-card");
    expect(card.querySelector(".session-card-date")?.textContent).toMatch(/Jan 2/);
    expect(card.querySelector(".spark")).toBeInTheDocument();
    expect(card.querySelectorAll(".spark-bar").length).toBe(2);
    expect(card.querySelector(".spark-compactions")).toHaveTextContent("◆1");
    expect(container.querySelector(".usage-shell")).not.toBeInTheDocument();
  });

  it("scales the card flame to an absolute 30-minute axis so durations compare and long convos scroll", async () => {
    render(App, { props: { client: fakeUsageClient() } });

    const fifteenMin = await screen.findByRole("button", { name: /Implement UI/ });
    const sixtyMin = screen.getByRole("button", { name: /Review telemetry/ });

    // Full flame width represents 30 minutes: 15m fills half, 60m exceeds 100% and scrolls in the card.
    expect(fifteenMin.querySelector<HTMLElement>(".session-card-flame")!.style.getPropertyValue("--flame-width")).toBe("50%");
    expect(sixtyMin.querySelector<HTMLElement>(".session-card-flame")!.style.getPropertyValue("--flame-width")).toBe("200%");
  });

  it("opens a conversation into the top bar, flame graph, and bottleneck panel", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← All conversations" })).toBeInTheDocument();
    expect(container.querySelector(".read-heading h1")).toHaveTextContent("Implement UI");
    expect(screen.getByLabelText("Conversation flame graph")).toBeInTheDocument();
    expect(screen.getByLabelText("Bottlenecks")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(container.querySelector(".pane-rail")).not.toBeInTheDocument();
    expect(container.querySelector(".turn-prompt-label")).toHaveTextContent("Assistant · gpt");
    expect(container.querySelector(".segment")).toBeInTheDocument();
  });

  it("scales turn width by wall duration and zoom", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    const turn = container.querySelector<HTMLElement>(".turn-column")!;
    expect(turn.style.width).toBe("600px"); // 600000ms * 0.001 px/ms at zoom 1

    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(container.querySelector<HTMLElement>(".turn-column")!.style.width).toBe("1200px");

    await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(container.querySelector<HTMLElement>(".turn-column")!.style.width).toBe("600px");
  });

  it("scales bar height by cumulative context tokens", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    const bars = container.querySelectorAll<HTMLElement>(".turn-bar");
    // 1200/1200 ctx -> full height; 600/1200 -> half of the 16..72px range.
    expect(bars[0].style.height).toBe("72px");
    expect(bars[1].style.height).toBe("44px");
  });

  it("labels a wide command segment with the command that ran", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    const label = container.querySelector(".segment-label");
    expect(label).toHaveTextContent("npm test -w @tangent/usage-ui");
  });

  it("activates a segment and shows its work-turn transcript", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    const segment = container.querySelector<HTMLButtonElement>(".segment")!;
    await fireEvent.click(segment);

    expect(container.querySelector(".segment")).toHaveClass("active");
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("Done");
  });

  it("ranks slow steps and jumps to them from the bottleneck panel", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    const bottleneck = container.querySelector<HTMLButtonElement>(".bottleneck-jump")!;
    // The row leads with the actual command that ran, not the generic step kind.
    expect(bottleneck.querySelector(".bottleneck-label")).toHaveTextContent("npm test -w @tangent/usage-ui");
    expect(bottleneck.querySelector(".bottleneck-label")).toHaveClass("is-command");
    expect(bottleneck).toHaveTextContent("command");
    expect(bottleneck).toHaveTextContent("5m");

    await fireEvent.click(bottleneck);

    expect(container.querySelector(".bottleneck-row")).toHaveClass("active");
    expect(container.querySelector(".segment.active")).not.toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Next bottleneck" }));
    expect(container.querySelector(".bottleneck-row")).toHaveClass("active");
  });

  it("marks bottleneck segments on the flame graph", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    expect(container.querySelector(".segment.is-bottleneck")).not.toBeNull();
  });

  it("returns to the browse gallery from the top bar", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    await screen.findByText("Done");

    await fireEvent.click(screen.getByRole("button", { name: "← All conversations" }));

    expect(container.querySelector(".usage-browse")).toBeInTheDocument();
    expect(container.querySelector(".usage-shell")).not.toBeInTheDocument();
  });

  it("previews long messages until they are expanded", async () => {
    const longText = `${"a".repeat(360)} hidden suffix`;
    const view = fakeConversationView();
    view.messages[0] = { ...view.messages[0], text: longText, textPreview: "short preview" };
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Returns the prepared long-message view. */
          getConversationView: async () => view
        })
      }
    });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));

    expect(await screen.findByRole("button", { name: "Show full message (374 chars)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).not.toHaveTextContent("hidden suffix");

    await fireEvent.click(container.querySelector<HTMLButtonElement>(".message-expand")!);

    expect(await screen.findByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("hidden suffix");
  });

  it("keeps tool output hidden until the command row is expanded", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: /Implement UI/ }));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(container).toHaveTextContent("npm test -w @tangent/usage-ui");
    expect(container).not.toHaveTextContent("All tests passed");

    await fireEvent.click(screen.getByRole("button", { name: /show npm test -w @tangent\/usage-ui details/i }));

    expect(screen.getByRole("button", { name: /hide npm test -w @tangent\/usage-ui details/i })).toHaveAttribute("aria-expanded", "true");
    expect(container).toHaveTextContent("Directory");
    expect(container).toHaveTextContent("All tests passed");
  });

  it("leads with a project rail and scopes the cards to the selected project", async () => {
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Two projects, alpha more recently active than beta. */
          async listSessions() {
            return {
              sessions: [
                { ...sessionListItem("a1", "Work one", 100, 1000, "2026-01-02T12:00:00.000Z"), project: "alpha" },
                { ...sessionListItem("b1", "Work two", 100, 1000, "2026-01-02T09:00:00.000Z"), project: "beta" }
              ],
              caveats: []
            };
          }
        })
      }
    });

    // The most recently active project leads and is auto-selected; only its card shows.
    await screen.findByRole("button", { name: /Work one/ });
    expect(container.querySelector(".project-rail-item.active")).toHaveTextContent("alpha");
    expect(screen.queryByRole("button", { name: /Work two/ })).not.toBeInTheDocument();

    // Selecting beta in the rail scopes the gallery to beta's card.
    await fireEvent.click(screen.getByRole("button", { name: /beta/ }));
    expect(await screen.findByRole("button", { name: /Work two/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Work one/ })).not.toBeInTheDocument();
  });

  it("renders identically in standalone and embedded mount modes", async () => {
    const standalone = document.body.appendChild(document.createElement("div"));
    const embedded = document.body.appendChild(document.createElement("div"));
    const disposeStandalone = mountUsageApp(standalone, { client: fakeUsageClient() });
    const disposeEmbedded = mountUsageApp(embedded, { client: fakeUsageClient(), embedded: true });

    try {
      await within(standalone).findByRole("button", { name: /Implement UI/ });
      await within(embedded).findByRole("button", { name: /Implement UI/ });
      expect(standalone.querySelector(".usage-browse")?.outerHTML).toEqual(embedded.querySelector(".usage-browse")?.outerHTML);
    } finally {
      disposeStandalone();
      disposeEmbedded();
    }
  });
});

/** Creates a Usage UI client with deterministic fixture data for component tests. */
function fakeUsageClient(overrides: Partial<UsageUiClient> = {}): UsageUiClient {
  return {
    /** Lists fixture sessions for the browse gallery and rail. */
    async listSessions() {
      return {
        sessions: [
          sessionListItem("s1", "Implement UI", 1200, 900000, "2026-01-02T09:00:00.000Z"),
          sessionListItem("s2", "Review telemetry", 840, 3600000, "2026-01-02T10:00:00.000Z")
        ],
        caveats: []
      };
    },
    /** Returns a fixture conversation view for the selected session. */
    async getConversationView(id = "s1") {
      return fakeConversationView(id);
    },
    /** Fails if a test unexpectedly calls the session detail endpoint. */
    async getSession() {
      throw new Error("not used");
    },
    /** Fails if a test unexpectedly calls the cockpit endpoint. */
    async getCockpit() {
      throw new Error("not used");
    },
    /** Fails if a test unexpectedly calls the timeline view endpoint. */
    async getSessionTimelineView() {
      throw new Error("not used");
    },
    /** Fails if a test unexpectedly calls the raw timeline endpoint. */
    async getSessionTimeline() {
      throw new Error("not used");
    },
    /** Fails if a test unexpectedly calls the transcript endpoint. */
    async getTranscript() {
      throw new Error("not used");
    },
    /** Fails if a test unexpectedly calls the message selection endpoint. */
    async getMessageSelection() {
      throw new Error("not used");
    },
    ...overrides
  };
}

/** Builds a compact session-list fixture row with a flame series. */
function sessionListItem(id: string, title: string, peakContext: number, durationMs: number, startedAt: string) {
  return {
    id,
    title,
    provider: "codex",
    model: "gpt",
    status: "completed",
    startedAt,
    peakContext,
    durationMs,
    flame: fakeSparkline(durationMs)
  };
}

/** Builds a deterministic two-bucket sparkline with one compaction marker. */
function fakeSparkline(durationMs = 60000): UsageSparkline {
  return {
    durationMs,
    tokensTotal: 1200,
    compactions: 1,
    buckets: [
      { kind: "model", tokenShare: 1, durationShare: 1 },
      { kind: "tool", tokenShare: 0.3, durationShare: 0.5 }
    ]
  };
}

/**
 * Builds a two-turn conversation fixture. The first turn is long (10m) and token-heavy (1.2K ctx)
 * with a model segment plus a slow `npm test` command; the second is shorter (2m) and lighter
 * (600 ctx). This lets tests prove turn width tracks duration and bar height tracks tokens.
 */
function fakeConversationView(id = "s1"): UsageConversationView {
  return {
    selected: {
      id,
      title: "Implement UI",
      provider: "codex",
      status: "completed",
      model: "gpt",
      durationLabel: "10m",
      tokenLabel: "1.2K ctx"
    },
    projects: [],
    messages: [{
      id: "m1",
      role: "assistant",
      title: "Assistant · gpt",
      textPreview: "Done",
      tokenLabel: "1.2K ctx",
      tokens: 1200,
      durationLabel: "10m",
      durationMs: 600000,
      confidence: "exact",
      toolCalls: [{
        id: "t1",
        name: "exec_command",
        status: "success",
        durationLabel: "5m",
        target: "/repo",
        commandPreview: "npm test -w @tangent/usage-ui",
        workdir: "/repo",
        preview: "npm test -w @tangent/usage-ui",
        resultDisplayPreview: "All tests passed",
        resultPreview: "Chunk ID: abc\nWall time: 0.0000 seconds\nOutput:\nAll tests passed"
      }]
    }, {
      id: "m2",
      role: "assistant",
      title: "Assistant · gpt",
      textPreview: "Committed",
      tokenLabel: "600 ctx",
      tokens: 600,
      durationLabel: "2m",
      durationMs: 120000,
      confidence: "exact",
      toolCalls: []
    }],
    chart: {
      maxTokens: 1200,
      maxAddedTokens: 400,
      maxDurationMs: 600000,
      rows: [{
        id: "row:m1",
        messageId: "m1",
        messageIds: ["m1"],
        role: "assistant",
        label: "Assistant · gpt",
        tokens: 1200,
        tokenLabel: "1.2K ctx",
        durationMs: 600000,
        durationLabel: "10m",
        widthShare: 1,
        tokenModes: {
          cumulative: { tokens: 1200, tokenLabel: "1.2K ctx", widthShare: 1 },
          added: { tokens: 400, tokenLabel: "400 added", widthShare: 1 / 3 }
        },
        heightShare: 1,
        anchor: false,
        confidence: "exact",
        segments: [{
          id: "m1:model",
          messageId: "m1",
          stepId: "model",
          label: "Assistant response",
          kind: "assistant",
          durationLabel: undefined,
          heightShare: 0.5,
          confidence: "exact"
        }, {
          id: "m1:s1",
          messageId: "m1",
          stepId: "s1",
          label: "exec",
          detail: "npm test -w @tangent/usage-ui",
          kind: "command",
          durationMs: 300000,
          durationLabel: "5m",
          heightShare: 0.5,
          confidence: "exact"
        }]
      }, {
        id: "row:m2",
        messageId: "m2",
        messageIds: ["m2"],
        role: "assistant",
        label: "Commit",
        tokens: 600,
        tokenLabel: "600 ctx",
        durationMs: 120000,
        durationLabel: "2m",
        widthShare: 0.5,
        tokenModes: {
          cumulative: { tokens: 600, tokenLabel: "600 ctx", widthShare: 0.5 },
          added: { tokens: 200, tokenLabel: "200 added", widthShare: 1 / 6 }
        },
        heightShare: 0.2,
        anchor: false,
        confidence: "exact",
        segments: [{
          id: "m2:s1",
          messageId: "m2",
          stepId: "s2",
          label: "exec",
          detail: "git commit",
          kind: "command",
          durationMs: 120000,
          durationLabel: "2m",
          heightShare: 1,
          confidence: "exact"
        }]
      }]
    },
    bottlenecks: [{
      id: "m1:s1",
      rowId: "row:m1",
      messageId: "m1",
      stepId: "s1",
      label: "exec",
      detail: "npm test -w @tangent/usage-ui",
      kind: "command",
      durationMs: 300000,
      durationLabel: "5m",
      confidence: "exact",
      rank: 1
    }],
    caveats: []
  };
}
