import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import { mountUsageApp } from "./mount.js";
import type { UsageConversationView, UsageUiClient } from "@tangent/usage-ui-data";

afterEach(() => cleanup());

describe("usage svelte app", () => {
  it("renders finder, conversation, and chart panes at once", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    expect(await screen.findByText("Done")).toBeInTheDocument();
    const shell = container.querySelector(".usage-shell");
    expect(shell).not.toHaveAttribute("data-open-drawer");
    expect(screen.getByLabelText("Conversation picker")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(screen.getByLabelText("Tokens and duration chart")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Turns" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Implement UI" })).not.toBeInTheDocument();
    expect(container.querySelector(".chart-inner")).toBeInTheDocument();
    expect(container.querySelector(".finder-content")).toBeInTheDocument();
    expect(container.querySelector(".drawer")).not.toBeInTheDocument();
    expect(container.querySelector(".finder-rail")).not.toBeInTheDocument();
    expect(container.querySelector(".chart-rail")).not.toBeInTheDocument();
    expect(container.querySelector(".chart-toggle")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant · gpt")).not.toBeInTheDocument();
    expect(container.querySelector(".row-label")).not.toBeInTheDocument();
    expect(container.querySelector(".caveats")).not.toBeInTheDocument();
    expect(container.querySelector(".duration-ruler-label")).toHaveTextContent("1m");
    expect(container.querySelector(".tool-event")).toHaveTextContent("npm test -w @tangent/usage-ui");
    expect(container.querySelector(".tool-event")).not.toHaveTextContent("Chunk ID");
  });

  it("expands project sessions without replacing the project list during session changes", async () => {
    const pending = deferred<UsageConversationView>();
    const getConversationView = vi.fn(async (id: string) => id === "s2" ? pending.promise : fakeConversationView(id));
    const { container } = render(App, { props: { client: fakeUsageClient({ getConversationView }) } });

    const projectRow = await screen.findByRole("button", { name: "repo 2 sessions" });
    expect(projectRow).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".session-row")).not.toBeInTheDocument();
    await fireEvent.click(projectRow);
    expect(projectRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "← Projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other 1 sessions" })).toBeInTheDocument();

    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".session-row")[1]);

    expect(screen.queryByLabelText("Loading Usage UI")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation picker")).toBeInTheDocument();
    expect(screen.getByLabelText("Tokens and duration chart")).toBeInTheDocument();
    expect(getConversationView).toHaveBeenCalledWith("s2", { query: "", limit: 80 });

    pending.resolve(fakeConversationView("s2"));
    expect(await screen.findByText("Checked the trace")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review telemetry" })).not.toBeInTheDocument();

    await fireEvent.click(projectRow);
    expect(projectRow).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".session-row")).not.toBeInTheDocument();
  });

  it("shows conversation telemetry in project session rows", async () => {
    render(App, { props: { client: fakeUsageClient() } });

    await fireEvent.click(await screen.findByRole("button", { name: "repo 2 sessions" }));
    expect(await screen.findByText("Last Jan 2, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("6 messages")).toBeInTheDocument();
    expect(screen.getByText("1.2K tokens")).toBeInTheDocument();
    expect(screen.queryByText("2 tool calls")).not.toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
  });

  it("keeps active message and chart row activation wired", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    expect(await screen.findByText("Done")).toBeInTheDocument();

    const chartRow = container.querySelector<HTMLButtonElement>(".chart-row")!;
    await fireEvent.click(chartRow);

    expect(chartRow).toHaveClass("active");
    expect(container.querySelector(".message")).toHaveClass("active");
  });

  it("switches work-turn chart rows between cumulative and added tokens", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cumulative" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".row-metrics")).toHaveTextContent("1.2K · 1m");
    expect(container.querySelector<HTMLButtonElement>(".chart-row")?.style.getPropertyValue("--row-width")).toBe("1");

    await fireEvent.click(screen.getByRole("button", { name: "Added" }));

    expect(screen.getByRole("button", { name: "Added" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".row-metrics")).toHaveTextContent("400 added · 1m");
    expect(container.querySelector<HTMLButtonElement>(".chart-row")?.style.getPropertyValue("--row-width")).toBe("0.3333333333333333");

    await fireEvent.click(screen.getByRole("button", { name: "Cumulative" }));

    expect(container.querySelector(".row-metrics")).toHaveTextContent("1.2K · 1m");
  });

  it("derives token modes when the API still returns legacy chart rows", async () => {
    const view = fakeConversationView();
    view.chart.maxTokens = 110_000;
    view.chart.maxAddedTokens = undefined as never;
    view.chart.rows = [{
      ...view.chart.rows[0],
      tokens: 100_000,
      tokenLabel: "100k ctx / 30k out",
      widthShare: 130_000 / 111_000,
      tokenModes: undefined as never
    }, {
      ...view.chart.rows[0],
      id: "row:m2",
      messageId: "m2",
      messageIds: ["m2"],
      tokens: 110_000,
      tokenLabel: "110k ctx / 1k out",
      widthShare: 1,
      tokenModes: undefined as never
    }];
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Returns a legacy fixture without server-derived token modes. */
          getConversationView: async () => view
        })
      }
    });

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(container.querySelectorAll(".row-metrics")[0]).toHaveTextContent("100k ctx · 1m");
    expect(container.querySelectorAll<HTMLButtonElement>(".chart-row")[0].style.getPropertyValue("--row-width")).toBe(String(100_000 / 110_000));
    expect(container.querySelectorAll<HTMLButtonElement>(".chart-row")[1].style.getPropertyValue("--row-width")).toBe("1");

    await fireEvent.click(screen.getByRole("button", { name: "Added" }));

    expect(container.querySelectorAll(".row-metrics")[0]).toHaveTextContent("100k added · 1m");
    expect(container.querySelectorAll(".row-metrics")[1]).toHaveTextContent("10k added · 1m");
    expect(container.querySelectorAll<HTMLButtonElement>(".chart-row")[1].style.getPropertyValue("--row-width")).toBe("0.1");
  });

  it("keeps a grouped work turn active for any message inside the group", async () => {
    const view = fakeConversationView();
    view.messages.push({
      id: "m2",
      role: "assistant",
      title: "Assistant · gpt",
      textPreview: "Still working",
      tokenLabel: "400",
      tokens: 400,
      durationLabel: "20s",
      durationMs: 20000,
      confidence: "exact",
      toolCalls: []
    });
    view.chart.rows[0].messageIds = ["m1", "m2"];
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Returns a fixture view with a chart row covering multiple messages. */
          getConversationView: async () => view
        })
      }
    });

    expect(await screen.findByText("Still working")).toBeInTheDocument();
    await fireEvent.click(screen.getByText("Still working").closest<HTMLButtonElement>(".message-main")!);

    expect(container.querySelector(".chart-row")).toHaveClass("active");
  });

  it("scrolls activation targets inside the intended Usage pane", async () => {
    const view = fakeConversationView();
    view.messages.unshift({
      id: "u1",
      role: "user",
      title: "User",
      textPreview: "Please implement the UI",
      confidence: "exact",
      toolCalls: []
    });
    view.chart.rows[0].messageIds = ["u1", "m1"];
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Returns a fixture view with a work turn anchored by a user prompt. */
          getConversationView: async () => view
        })
      }
    });

    expect(await screen.findByText("Done")).toBeInTheDocument();
    const messageList = container.querySelector<HTMLElement>(".message-list")!;
    const chartScroll = container.querySelector<HTMLElement>(".chart-scroll")!;
    const userMessage = container.querySelector<HTMLElement>(".message-user")!;
    const chartRow = container.querySelector<HTMLButtonElement>(".chart-row")!;
    const messageScrollTo = vi.fn();
    const chartScrollTo = vi.fn();
    installScrollGeometry(messageList, { top: 0, height: 600, scrollTo: messageScrollTo });
    installScrollGeometry(chartScroll, { top: 0, height: 420, scrollTo: chartScrollTo });
    installRect(userMessage, { top: 160, height: 48 });
    installRect(chartRow, { top: 96, height: 32 });
    await settleMicrotasks();
    messageScrollTo.mockClear();
    chartScrollTo.mockClear();

    await fireEvent.click(container.querySelector<HTMLButtonElement>(".chart-row")!);

    expect(messageScrollTo).toHaveBeenCalledWith({ top: 160, behavior: "auto" });
    expect(chartScrollTo).not.toHaveBeenCalled();

    messageScrollTo.mockClear();
    await fireEvent.click(userMessage.querySelector<HTMLButtonElement>(".message-main")!);

    expect(chartScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(messageScrollTo).not.toHaveBeenCalled();
  });

  it("keeps work-turn activation identical in standalone and embedded mount modes", async () => {
    const standalone = document.body.appendChild(document.createElement("div"));
    const embedded = document.body.appendChild(document.createElement("div"));
    const disposeStandalone = mountUsageApp(standalone, { client: fakeUsageClient() });
    const disposeEmbedded = mountUsageApp(embedded, { client: fakeUsageClient(), embedded: true });

    try {
      await within(standalone).findByText("Done");
      await within(embedded).findByText("Done");

      await fireEvent.click(standalone.querySelector<HTMLButtonElement>(".chart-row")!);
      await fireEvent.click(embedded.querySelector<HTMLButtonElement>(".chart-row")!);

      expect(standalone.querySelector(".chart-row")).toHaveClass("active");
      expect(standalone.querySelector(".message")).toHaveClass("active");
      expect(embedded.querySelector(".chart-row")).toHaveClass("active");
      expect(embedded.querySelector(".message")).toHaveClass("active");
      expect(standalone.querySelector(".usage-shell")?.outerHTML).toEqual(embedded.querySelector(".usage-shell")?.outerHTML);
    } finally {
      disposeStandalone();
      disposeEmbedded();
    }
  });

  it("previews long messages until they are expanded", async () => {
    const longText = `${"a".repeat(360)} hidden suffix`;
    const view = fakeConversationView();
    view.messages[0] = {
      ...view.messages[0],
      text: longText,
      textPreview: "short preview"
    };
    const { container } = render(App, {
      props: {
        client: fakeUsageClient({
          /** Returns a fixture view with one long message body. */
          getConversationView: async () => view
        })
      }
    });

    expect(await screen.findByRole("button", { name: "Show full message (374 chars)" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("hidden suffix");

    await fireEvent.click(container.querySelector<HTMLButtonElement>(".message-expand")!);

    expect(await screen.findByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(container).toHaveTextContent("hidden suffix");
  });

  it("keeps tool output hidden until the command row is expanded", async () => {
    const { container } = render(App, { props: { client: fakeUsageClient() } });

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(container).toHaveTextContent("npm test -w @tangent/usage-ui");
    expect(container).not.toHaveTextContent("Chunk ID");
    expect(container).not.toHaveTextContent("All tests passed");

    await fireEvent.click(screen.getByRole("button", { name: /show npm test -w @tangent\/usage-ui details/i }));

    expect(screen.getByRole("button", { name: /hide npm test -w @tangent\/usage-ui details/i })).toHaveAttribute("aria-expanded", "true");
    expect(container).toHaveTextContent("Directory");
    expect(container).toHaveTextContent("/repo");
    expect(container).toHaveTextContent("All tests passed");
    expect(container).not.toHaveTextContent("Chunk ID");
  });
});

/** Creates a Usage UI client with deterministic fixture data for component tests. */
function fakeUsageClient(overrides: Partial<UsageUiClient> = {}): UsageUiClient {
  return {
    /** Lists fixture sessions for the finder pane. */
    async listSessions() {
      return {
        sessions: [sessionListItem("s1", "Implement UI", 1200, 60000), sessionListItem("s2", "Review telemetry", 840, 42000)],
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

/** Builds a compact session-list fixture row. */
function sessionListItem(id: string, title: string, tokensTotal: number, durationMs: number) {
  return {
    id,
    title,
    provider: "codex",
    status: "completed",
    tokensTotal,
    durationMs
  };
}

/** Builds a conversation fixture with one assistant message and matching chart row. */
function fakeConversationView(id = "s1"): UsageConversationView {
  const selected = id === "s2"
    ? { title: "Review telemetry", durationLabel: "42s", tokenLabel: "840", tokens: 840, text: "Checked the trace" }
    : { title: "Implement UI", durationLabel: "1m", tokenLabel: "1.2K", tokens: 1200, text: "Done" };
  return {
    selected: {
      id,
      title: selected.title,
      provider: "codex",
      status: "completed",
      model: "gpt",
      durationLabel: selected.durationLabel,
      tokenLabel: selected.tokenLabel
    },
    projects: [{
      id: "repo",
      label: "repo",
      sessions: [
        { id: "s1", title: "Implement UI", provider: "codex", model: "gpt", status: "completed", lastActivityLabel: "Jan 2, 9:00 AM", durationLabel: "1m", tokenLabel: "1.2K", messageCountLabel: "6 messages", toolCallLabel: "2 tool calls" },
        { id: "s2", title: "Review telemetry", provider: "codex", model: "gpt", status: "completed", lastActivityLabel: "Jan 2, 10:00 AM", durationLabel: "42s", tokenLabel: "840", messageCountLabel: "4 messages", toolCallLabel: "1 tool call" }
      ]
    }, {
      id: "other",
      label: "other",
      sessions: [
        { id: "s3", title: "Other work", provider: "codex", model: "gpt", status: "completed", lastActivityLabel: "Jan 1, 4:00 PM", durationLabel: "2m", tokenLabel: "2K", messageCountLabel: "8 messages", toolCallLabel: "3 tool calls" }
      ]
    }],
    messages: [{
      id: "m1",
      role: "assistant",
      title: "Assistant · gpt",
      textPreview: selected.text,
      tokenLabel: selected.tokenLabel,
      tokens: selected.tokens,
      durationLabel: selected.durationLabel,
      durationMs: id === "s2" ? 42000 : 60000,
      confidence: "exact",
      toolCalls: [{
        id: "t1",
        name: "exec_command",
        status: "success",
        durationLabel: "20s",
        target: "/repo",
        commandPreview: "npm test -w @tangent/usage-ui",
        workdir: "/repo",
        preview: "npm test -w @tangent/usage-ui",
        resultDisplayPreview: "All tests passed",
        resultPreview: "Chunk ID: abc\nWall time: 0.0000 seconds\nOutput:\nAll tests passed"
      }]
    }],
    chart: {
      maxTokens: 1200,
      maxAddedTokens: 400,
      maxDurationMs: 60000,
      rows: [{
        id: "row:m1",
        messageId: "m1",
        messageIds: ["m1"],
        role: "assistant",
        label: "Assistant · gpt",
        tokens: selected.tokens,
        tokenLabel: selected.tokenLabel,
        durationMs: id === "s2" ? 42000 : 60000,
        durationLabel: selected.durationLabel,
        widthShare: 1,
        tokenModes: {
          cumulative: {
            tokens: selected.tokens,
            tokenLabel: selected.tokenLabel,
            widthShare: 1
          },
          added: {
            tokens: 400,
            tokenLabel: "400 added",
            widthShare: 1 / 3
          }
        },
        heightShare: 1,
        anchor: false,
        confidence: "exact",
        segments: [{
          id: "m1:s1",
          messageId: "m1",
          stepId: "s1",
          label: "exec",
          kind: "command",
          durationMs: 20000,
          durationLabel: "20s",
          heightShare: 1,
          confidence: "exact"
        }]
      }]
    },
    caveats: []
  };
}

/** Creates a promise that tests can resolve after intermediate UI assertions. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Waits for Svelte's async load/tick work to settle in component tests. */
async function settleMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Installs deterministic dimensions and a scroll spy on a scroll container. */
function installScrollGeometry(node: HTMLElement, options: { top: number; height: number; scrollTo: ReturnType<typeof vi.fn> }): void {
  installRect(node, { top: options.top, height: options.height });
  Object.defineProperty(node, "clientHeight", { configurable: true, value: options.height });
  Object.defineProperty(node, "scrollTop", { configurable: true, writable: true, value: 0 });
  Object.defineProperty(node, "scrollTo", { configurable: true, value: options.scrollTo });
}

/** Installs deterministic viewport geometry on an element. */
function installRect(node: HTMLElement, rect: { top: number; height: number }): void {
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    /** Returns deterministic viewport geometry for jsdom. */
    value: () => ({
      top: rect.top,
      bottom: rect.top + rect.height,
      height: rect.height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: rect.top,
      /** Supports DOMRect JSON serialization in tests. */
      toJSON: () => undefined
    })
  });
}
