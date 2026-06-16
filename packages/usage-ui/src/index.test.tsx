import "./test-setup.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UsageApp } from "./app/UsageApp.js";
import type { UsageUiClient } from "@tangent/usage-ui-data";

describe("usage ui", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/usage/sessions");
  });

  it("renders session data from the Usage UI client", async () => {
    render(<UsageApp client={fakeUsageClient()} />);
    expect(await screen.findByText("Implement UI")).toBeInTheDocument();
    expect(await screen.findByText("1,200")).toBeInTheDocument();
    expect(await screen.findByText("Transcript preview")).toBeInTheDocument();
  });

  it("switches sidebar views without a document reload", async () => {
    render(<UsageApp client={fakeUsageClient()} />);
    await screen.findByRole("heading", { name: "Implement UI", level: 1 });

    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));

    expect(window.location.pathname).toBe("/usage/timeline");
    expect(await screen.findByRole("heading", { name: "Selected timeline" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timeline", current: "page" })).toBeInTheDocument();
  });
});

/** Creates deterministic Usage UI data for render tests. */
function fakeUsageClient(): UsageUiClient {
  return {
    /** Lists fake sessions. */
    async listSessions() {
      return {
        sessions: [{
          id: "s1",
          title: "Implement UI",
          subtitle: "codex · gpt",
          provider: "codex",
          model: "gpt",
          startedAt: "2026-06-15T10:00:00.000Z",
          tokensTotal: 1200,
          toolCalls: 3,
          caveatCount: 1
        }],
        caveats: []
      };
    },
    /** Gets fake session details. */
    async getSession() {
      return {
        session: {
          id: "s1",
          title: "Implement UI",
          provider: "codex",
          model: "gpt",
          startedAt: "2026-06-15T10:00:00.000Z",
          durationMs: 2500,
          tokensTotal: 1200,
          toolCalls: 3,
          filesTouched: 2,
          caveatCount: 1
        },
        summaryCards: [
          { label: "Duration", value: 2500, unit: "ms", confidence: "derived" },
          { label: "Tokens", value: 1200, unit: "tokens", confidence: "exact" },
          { label: "Tool calls", value: 3, unit: "count" },
          { label: "Files touched", value: 2, unit: "files" },
          { label: "Caveats", value: 1, unit: "count" }
        ],
        nextActions: [{ id: "transcript", label: "Open transcript", href: "/usage/sessions/s1/messages" }],
        caveats: ["partial timing"]
      };
    },
    /** Gets fake timeline data. */
    async getSessionTimeline() {
      return {
        schema: "tangent.usage.timeline.v1",
        metric: "selfDurationMs",
        items: [{ id: "step1", label: "Assistant response", kind: "assistant_response", durationMs: 2500, metricValue: 2500 }]
      };
    },
    /** Gets fake transcript data. */
    async getTranscript() {
      return {
        schema: "tangent.usage.transcript.v1",
        messages: [{ id: "m1", role: "assistant", textPreview: "Done", tokens: { label: "Tokens", value: 1200, unit: "tokens" } }],
        caveats: []
      };
    },
    /** Gets fake message selection data. */
    async getMessageSelection() {
      return { messages: [], caveats: [] };
    }
  };
}
