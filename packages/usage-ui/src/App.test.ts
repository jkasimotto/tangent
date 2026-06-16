import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { UsageConversationView, UsageUiClient } from "@tangent/usage-ui-data";

afterEach(() => cleanup());

describe("usage svelte app", () => {
  it("renders sessions and opens the chart pane", async () => {
    render(App, { props: { client: fakeUsageClient() } });

    expect(await screen.findAllByRole("heading", { name: "Implement UI" })).toHaveLength(2);
    expect(screen.getByLabelText("Conversation picker")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show metrics chart" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Show sessions" })).toBeDisabled();

    await fireEvent.click(screen.getByRole("button", { name: "Show metrics chart" }));

    expect(screen.getByLabelText("Tokens and duration chart")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show metrics chart" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show sessions" })).toBeEnabled();
    expect(screen.getAllByText("Assistant · gpt")).toHaveLength(2);
    expect(screen.getByText("exec")).toBeInTheDocument();
  });

  it("drills into project sessions without replacing the shell during session changes", async () => {
    const pending = deferred<UsageConversationView>();
    const getConversationView = vi.fn(async (id: string) => id === "s2" ? pending.promise : fakeConversationView(id));
    render(App, { props: { client: fakeUsageClient({ getConversationView }) } });

    expect(await screen.findByRole("button", { name: "repo 2 sessions" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "repo 2 sessions" }));
    expect(screen.getByRole("button", { name: "← Projects" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Review telemetry codex · 42s · 840" }));

    expect(screen.queryByLabelText("Loading Usage UI")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(getConversationView).toHaveBeenCalledWith("s2", { query: "", limit: 80 });

    pending.resolve(fakeConversationView("s2"));
    expect(await screen.findAllByRole("heading", { name: "Review telemetry" })).toHaveLength(2);
  });
});

function fakeUsageClient(overrides: Partial<UsageUiClient> = {}): UsageUiClient {
  return {
    async listSessions() {
      return {
        sessions: [sessionListItem("s1", "Implement UI", 1200, 60000), sessionListItem("s2", "Review telemetry", 840, 42000)],
        caveats: []
      };
    },
    async getConversationView(id = "s1") {
      return fakeConversationView(id);
    },
    async getSession() {
      throw new Error("not used");
    },
    async getCockpit() {
      throw new Error("not used");
    },
    async getSessionTimelineView() {
      throw new Error("not used");
    },
    async getSessionTimeline() {
      throw new Error("not used");
    },
    async getTranscript() {
      throw new Error("not used");
    },
    async getMessageSelection() {
      throw new Error("not used");
    },
    ...overrides
  };
}

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
        { id: "s1", title: "Implement UI", provider: "codex", status: "completed", durationLabel: "1m", tokenLabel: "1.2K" },
        { id: "s2", title: "Review telemetry", provider: "codex", status: "completed", durationLabel: "42s", tokenLabel: "840" }
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
      toolCalls: [{ id: "t1", name: "exec", durationLabel: "20s" }]
    }],
    chart: {
      maxTokens: 1200,
      maxDurationMs: 60000,
      rows: [{
        id: "row:m1",
        messageId: "m1",
        role: "assistant",
        label: "Assistant · gpt",
        tokens: selected.tokens,
        tokenLabel: selected.tokenLabel,
        durationMs: id === "s2" ? 42000 : 60000,
        durationLabel: selected.durationLabel,
        widthShare: 1,
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
