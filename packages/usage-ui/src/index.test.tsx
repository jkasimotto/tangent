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
    expect(await screen.findByRole("heading", { name: "Implement UI", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("What happened")).toBeInTheDocument();
    expect(await screen.findByText("Transcript highlights")).toBeInTheDocument();
    expect(await screen.findByText("Where did cost go?")).toBeInTheDocument();
  });

  it("switches sidebar views without a document reload", async () => {
    render(<UsageApp client={fakeUsageClient()} />);
    await screen.findByRole("heading", { name: "Implement UI", level: 1 });

    fireEvent.click(screen.getByRole("link", { name: "Providers" }));

    expect(window.location.pathname).toBe("/usage/providers");
    expect(await screen.findByRole("heading", { name: "Provider context" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Providers", current: "page" })).toBeInTheDocument();
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
          status: "completed",
          durationMs: 2500,
          tokensTotal: 1200,
          toolCalls: 3,
          filesTouched: 2,
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
        nextActions: [{ id: "transcript", label: "Read transcript", href: "/usage/sessions/s1/messages" }],
        caveats: ["partial timing"]
      };
    },
    /** Gets fake cockpit details. */
    async getCockpit() {
      return {
        session: {
          provider: "codex",
          status: "complete",
          title: "Implement UI",
          subtitle: "gpt",
          timeRangeLabel: "Jun 15, 10:00 AM",
          repoLabel: "otto-tangent",
          branchLabel: "main",
          summary: "The agent inspected the UI and produced a cockpit redesign.",
          primaryFinding: { tone: "info", text: "Most attributed time was spent in assistant responses." },
          actions: [
            { id: "read-transcript", label: "Read transcript", href: "/usage/sessions/s1/messages" },
            { id: "inspect-trace", label: "Inspect trace", href: "/usage/sessions/s1/timeline" },
            { id: "compare", label: "Compare with another session", href: "/usage/sessions/s1/compare" },
            { id: "rollup", label: "Create rollup", href: "/rollup/new?session=s1" },
            { id: "export", label: "Export session data", href: "/api/usage/sessions/s1/export" },
            { id: "evidence", label: "Inspect evidence", href: "/usage/sessions/s1/evidence" }
          ]
        },
        finder: {
          tabs: [
            { id: "active", label: "Active", count: 0 },
            { id: "recent", label: "Recent", count: 1 },
            { id: "costly", label: "Costly", count: 0 },
            { id: "slow", label: "Slow", count: 0 },
            { id: "errors", label: "Errors", count: 0 },
            { id: "starred", label: "Starred", count: 0 }
          ],
          activeTab: "recent",
          searchPlaceholder: "Search sessions...",
          sortLabel: "Last activity",
          selectedSessionId: "s1",
          groups: [{
            id: "recent",
            label: "Recent",
            items: [{
              id: "s1",
              title: "Implement UI",
              provider: "codex",
              status: "complete",
              lastActivityLabel: "Jun 15, 10:00 AM",
              durationLabel: "3s",
              tokenLabel: "1.2K",
              toolCallCount: 3,
              fileCount: 2,
              caveatCount: 1,
              badges: ["partial-data"]
            }]
          }],
          items: [{
            id: "s1",
            title: "Implement UI",
            provider: "codex",
            status: "complete",
            lastActivityLabel: "Jun 15, 10:00 AM",
            durationLabel: "3s",
            tokenLabel: "1.2K",
            toolCallCount: 3,
            fileCount: 2,
            caveatCount: 1,
            badges: ["partial-data"]
          }],
          caveats: []
        },
        diagnostics: [
          { id: "duration", label: "Duration", value: "3s", confidence: "derived", interpretation: "Mostly assistant responses", inspectTarget: { kind: "metric", id: "duration" } },
          { id: "tokens", label: "Tokens", value: "1.2K", confidence: "exact", interpretation: "normal", inspectTarget: { kind: "metric", id: "tokens" } },
          { id: "tools", label: "Tools", value: "3", confidence: "derived", interpretation: "2 reads/searches - 1 writes", inspectTarget: { kind: "metric", id: "tools" } },
          { id: "files", label: "Files", value: "2", confidence: "derived", interpretation: "1 edited", inspectTarget: { kind: "metric", id: "files" } }
        ],
        storyline: {
          chapters: [{
            id: "prompt-setup",
            title: "Prompt & setup",
            summary: "User asked for UI implementation.",
            status: "complete",
            dominantKind: "prompt",
            steps: ["Implement UI"],
            actions: []
          }]
        },
        trace: {
          metric: "duration",
          grouping: "turn",
          range: { durationMs: 2500 },
          lanes: [{
            id: "model",
            label: "Assistant/model",
            items: [{
              id: "step1",
              stepId: "step1",
              label: "Assistant response",
              kind: "assistant_response",
              offsetMs: 0,
              durationMs: 2500,
              selfDurationMs: 2500,
              tokens: 1200,
              status: "success",
              confidence: "derived",
              colorRole: "model"
            }]
          }],
          totals: { sessionDurationMs: 2500, attributedDurationMs: 2500, unattributedDurationMs: 0, totalTokens: 1200 },
          caveats: []
        },
        breakdowns: [{
          id: "duration-by-kind",
          title: "Duration",
          metric: "duration",
          groupBy: "stepKind",
          unit: "ms",
          items: [{ id: "assistant", label: "Assistant responses", value: 2500, valueLabel: "3s", share: 1, shareLabel: "100%", colorRole: "model" }]
        }],
        transcriptHighlights: {
          highlights: [{
            id: "m1",
            kind: "assistant-result",
            title: "Assistant result",
            role: "assistant",
            summary: "Result or final visible answer from the assistant.",
            textPreview: "Done",
            tokenLabel: "1.2K",
            inspectTarget: { kind: "message", id: "m1" }
          }],
          actions: [{ id: "read-transcript", label: "Read transcript", href: "/usage/sessions/s1/messages" }]
        },
        inspector: {
          title: "Inspector",
          sessionHealth: [{ label: "Status", value: "Complete", tone: "success" }],
          anomalies: [],
          evidence: [{ label: "Session id", value: "s1" }],
          caveats: ["partial timing"],
          rawEvidenceTarget: { kind: "evidence", id: "s1" }
        }
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
