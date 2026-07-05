import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import Insights from "./Insights.svelte";
import type { UsageInsightsApiResponse, UsageInsightsClient, UsageInsightsParkResult } from "@tangent/usage-ui-data";

afterEach(() => cleanup());

/** Builds a fixture Insights API response with one visible and one parked finding. */
function fixtureResponse(overrides: Partial<UsageInsightsApiResponse> = {}): UsageInsightsApiResponse {
  return {
    scopeLabel: "all projects",
    windowDays: 30,
    totalMs: 10 * 60 * 60_000,
    categories: [
      { key: "findingInfo", label: "finding info", ms: 3_400_000, fraction: 0.34 },
      { key: "executing", label: "executing", ms: 2_200_000, fraction: 0.22 },
      { key: "writing", label: "writing", ms: 1_900_000, fraction: 0.19 }
    ],
    findings: [
      {
        generator: "recurring-long-commands",
        subject: "dart analyze",
        title: "dart analyze ran 41x, median 4m38s, total 3.2h",
        costMs: 3 * 60 * 60_000 + 12 * 60_000,
        costTokens: 1200,
        costTokensEstimated: true,
        evidence: [{ conversationId: "claude:c1", sessionId: "s1" }, { conversationId: "claude:c2", sessionId: "s2" }],
        remedyLabel: "document the correct scoped invocation in CLAUDE.md, or cache the result",
        fingerprint: "fp-visible",
        repo: "/repo/polez",
        parked: false
      },
      {
        generator: "re-read-churn-and-hot-files",
        subject: "src/util.ts",
        title: "src/util.ts re-read 6 times across 4 sessions",
        costMs: 45 * 60_000,
        costTokens: 400,
        costTokensEstimated: true,
        evidence: [{ conversationId: "claude:c3", sessionId: "s3" }],
        remedyLabel: "missing map: add a CLAUDE.md pointer or docs index entry",
        fingerprint: "fp-parked",
        repo: "/repo/polez",
        parked: true
      }
    ],
    ...overrides
  };
}

/** Builds a fake Insights client backed by an in-memory response, so park/unpark round-trip through the same fixture. */
function fakeInsightsClient(initial: UsageInsightsApiResponse): UsageInsightsClient & { setResponse(next: UsageInsightsApiResponse): void } {
  let response = initial;
  return {
    /** Replaces the fixture response returned by subsequent `getInsights` calls. */
    setResponse(next) {
      response = next;
    },
    /** Returns the current fixture response. */
    async getInsights() {
      return response;
    },
    /** Marks the given fingerprint as parked in the fixture response. */
    async park(fingerprint): Promise<UsageInsightsParkResult> {
      response = {
        ...response,
        findings: response.findings.map((finding) => (finding.fingerprint === fingerprint ? { ...finding, parked: true } : finding))
      };
      return { fingerprint, parked: true };
    },
    /** Marks the given fingerprint as not parked in the fixture response. */
    async unpark(fingerprint): Promise<UsageInsightsParkResult> {
      response = {
        ...response,
        findings: response.findings.map((finding) => (finding.fingerprint === fingerprint ? { ...finding, parked: false } : finding))
      };
      return { fingerprint, parked: false };
    }
  };
}

describe("Insights view", () => {
  it("renders the distribution header and the ranked findings feed", async () => {
    const client = fakeInsightsClient(fixtureResponse());
    render(Insights, { props: { client } });

    expect(await screen.findByText(/Agent time 10\.0h/)).toBeInTheDocument();
    expect(screen.getByText("finding info")).toBeInTheDocument();
    expect(screen.getByText("34%")).toBeInTheDocument();
    expect(screen.getByText(/dart analyze ran 41x/)).toBeInTheDocument();
    expect(screen.getByText("document the correct scoped invocation in CLAUDE.md, or cache the result")).toBeInTheDocument();
    // The parked finding is hidden until the toggle is used.
    expect(screen.queryByText(/re-read 6 times/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeInTheDocument();
  });

  it("expands evidence and opens a conversation from a finding's evidence row", async () => {
    const client = fakeInsightsClient(fixtureResponse());
    const onOpenConversation = vi.fn();
    render(Insights, { props: { client, onOpenConversation } });

    await fireEvent.click(await screen.findByRole("button", { name: /View sessions/ }));
    const openButton = await screen.findByRole("button", { name: "s1" });
    await fireEvent.click(openButton);
    expect(onOpenConversation).toHaveBeenCalledWith("claude:c1");
  });

  it("reveals parked findings behind the toggle and unparks one", async () => {
    const client = fakeInsightsClient(fixtureResponse());
    render(Insights, { props: { client } });

    await fireEvent.click(await screen.findByRole("button", { name: "Parked (1)" }));
    expect(await screen.findByText(/re-read 6 times/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Unpark" }));
    // Unparking refetches; the finding moves into the visible feed, so the parked list empties out.
    await screen.findByText(/re-read 6 times/); // still visible momentarily in the now-unparked list; wait for refetch below
    await fireEvent.click(screen.getByRole("button", { name: "Hide parked" }));
    expect(await screen.findByRole("button", { name: "Parked (0)" })).toBeInTheDocument();
  });

  it("parks a visible finding via its action button", async () => {
    const client = fakeInsightsClient(fixtureResponse());
    render(Insights, { props: { client } });

    await screen.findByText(/dart analyze ran 41x/);
    await fireEvent.click(screen.getByRole("button", { name: "Park" }));
    expect(await screen.findByText("Parked (2)")).toBeInTheDocument();
  });

  it("shows a read-only message instead of crashing when park is disabled", async () => {
    const client: UsageInsightsClient = {
      /** Returns the fixture response. */
      async getInsights() {
        return fixtureResponse();
      },
      /** Simulates the server's read-only-instance rejection. */
      async park() {
        throw new Error("Park disabled in verify harness.");
      },
      /** Simulates the server's read-only-instance rejection. */
      async unpark() {
        throw new Error("Unpark disabled in verify harness.");
      }
    };
    render(Insights, { props: { client } });

    await screen.findByText(/dart analyze ran 41x/);
    await fireEvent.click(screen.getByRole("button", { name: "Park" }));
    expect(await screen.findByText(/read-only instance/i)).toBeInTheDocument();
  });

  it("shows the empty state when the window has no agent time", async () => {
    const client = fakeInsightsClient(fixtureResponse({ totalMs: 0, findings: [] }));
    render(Insights, { props: { client } });

    expect(await screen.findByText(/No indexed conversations in this window/)).toBeInTheDocument();
  });

  it("calls onBack when the back button is used", async () => {
    const client = fakeInsightsClient(fixtureResponse());
    const onBack = vi.fn();
    render(Insights, { props: { client, onBack } });

    await fireEvent.click(await screen.findByRole("button", { name: "← Conversations" }));
    expect(onBack).toHaveBeenCalled();
  });
});
