import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { EvalCompareView, EvalDiffLineView, EvalDiffView, EvalRunDetailView, EvalUiClient, EvalVariantMetricsView } from "./client.js";

afterEach(() => cleanup());

describe("eval svelte app", () => {
  it("renders the selected run and each config's flame caption", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });

    expect(await screen.findByText(/ui-compare/)).toBeInTheDocument();
    await screen.findByLabelText("Configs compared");
    // Each config's metrics surface as a flame caption (duration / tokens / peak context).
    expect(container.querySelector(".flame-caption")).toBeInTheDocument();
  });

  it("opens on the aligned Compare view with two pickers and three sections", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");

    // Two config pickers, A and B, in the header.
    expect(container.querySelectorAll(".compare-head select")).toHaveLength(2);
    // Three aligned sections, in order.
    const titles = Array.from(container.querySelectorAll(".aligned-section h3")).map((n) => n.textContent?.trim());
    expect(titles).toEqual(["Prompts", "Context files", "Changed files"]);
    // No legacy mode tabs.
    expect(screen.queryByRole("button", { name: "Individual" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Side by side" })).toBeNull();
  });

  it("dims identical rows and marks differing ones", async () => {
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: false }
      ]
    });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");
    const rows = container.querySelectorAll(".aligned-row");
    // Prompt row identical -> dimmed; code row differs -> not dimmed.
    expect(container.querySelector(".aligned-section .aligned-row.identical")).toBeInTheDocument();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("scores a specific variant from its column header", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Score repo 8" }));
    const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
    expect(saved.variants["task/repo"].verdict.score).toBe(8);
  });

  it("expands a changed file to each side's diff and caches the fetch", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // Expand the changed code row on side A (empty variant).
    await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for empty" }));
    expect(await screen.findByText("Use repo context.")).toBeInTheDocument();
    const callsAfterFirst = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length;

    // Collapse and re-expand: no new fetch (served from cache).
    await fireEvent.click(screen.getByRole("button", { name: "Collapse src/foo.ts for empty" }));
    await fireEvent.click(screen.getByRole("button", { name: "Expand src/foo.ts for empty" }));
    expect((client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it("collapses unchanged code in the aligned view so the agent's edit is the focus", async () => {
    const equalBefore: EvalDiffLineView[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "equal" as const, leftNumber: i + 1, rightNumber: i + 1, left: `line ${i + 1}`, right: `line ${i + 1}`
    }));
    const addedLine: EvalDiffLineView = { kind: "add", rightNumber: 41, right: "added feature line" };
    const equalAfter: EvalDiffLineView[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "equal" as const, leftNumber: i + 41, rightNumber: i + 42, left: `line ${i + 41}`, right: `line ${i + 42}`
    }));
    const codeDiff: EvalDiffView = {
      artifact: { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true },
      left: { variantId: "empty", label: "task/empty" },
      right: { variantId: "repo", label: "task/repo" },
      lines: [...equalBefore, addedLine, ...equalAfter]
    };
    const client = fakeEvalClient({ codeDiff });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // Expand side B (repo) - the side with the added line.
    await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for repo" }));
    // The added line is visible.
    expect(await screen.findByText("added feature line")).toBeInTheDocument();
    // Equal runs were collapsed into gap placeholders.
    expect(container.querySelectorAll(".diff-gap").length).toBeGreaterThanOrEqual(1);
    // Far fewer rendered rows than the 80 equal lines fed in.
    const rowsInDetail = container.querySelectorAll(".aligned-detail .review-row");
    expect(rowsInDetail.length).toBeLessThan(80);
  });

  it("drills into a single variant+file to add a per-line note", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for empty" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Add notes on src/foo.ts for empty" }));

    // The focused reader opens scoped to empty/src/foo.ts.
    const overlay = container.querySelector(".drill-overlay") as HTMLElement;
    expect(overlay).toBeInTheDocument();
    await fireEvent.click(within(overlay).getAllByRole("button", { name: "👎" })[0]);
    await fireEvent.input(within(overlay).getByPlaceholderText(/what's wrong here/), { target: { value: "bad guard" } });
    await fireEvent.click(within(overlay).getByRole("button", { name: "Add" }));

    const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
    expect(saved.variants["task/empty"].notes.at(-1).text).toBe("bad guard");
  });

  // Task 4 reintroduces per-row content expansion (the unified-diff reader, stale-diff guard, scoped
  // artifact lists). These specs cover that surface and are restored when expansion lands.
  it.todo("reviews a variant using only artifacts present in it, never auto-selecting one absent from it");
  it.todo("lists only the files the reviewed variant changed, not files only the other variant touched");
  it("ignores a stale in-flight review diff when the drilled variant changes", async () => {
    // Deferred getDiff: capture each call's resolver so the drill fetches can be resolved out of order.
    const pending: Array<{ left: string; resolve: (view: EvalDiffView) => void }> = [];
    /** A one-line added diff whose text names the variant, so a stale overwrite is detectable. */
    const drillDiff = (variantId: string): EvalDiffView => ({
      artifact: { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true },
      left: { variantId, label: `task/${variantId}` },
      right: { variantId, label: `task/${variantId}` },
      lines: [{ kind: "add", rightNumber: 1, right: `content for ${variantId}` }]
    });
    const client = fakeEvalClient();
    client.getDiff = vi.fn((args) => new Promise<EvalDiffView>((resolve) => pending.push({ left: args.left, resolve })));
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // Drill into empty (its fetch stays in flight), close, then drill into repo.
    await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for empty" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Add notes on src/foo.ts for empty" }));
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for repo" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Add notes on src/foo.ts for repo" }));

    // The drill fetches: the empty one was issued before the repo one. Resolve repo first, then empty.
    const repoDrill = pending.filter((p) => p.left === "repo").at(-1);
    const emptyDrill = pending.filter((p) => p.left === "empty").at(-1);
    repoDrill?.resolve(drillDiff("repo"));
    const overlay = container.querySelector(".drill-overlay") as HTMLElement;
    await within(overlay).findByText("content for repo");
    emptyDrill?.resolve(drillDiff("empty"));
    await Promise.resolve();
    await Promise.resolve();

    // The stale empty diff must not overwrite the current repo drill.
    expect(within(overlay).getByText("content for repo")).toBeInTheDocument();
    expect(within(overlay).queryByText("content for empty")).toBeNull();
  });
  it.todo("collapses unchanged code in Individual review so the agent's edit is the focus");

  it("launches a run from the selected spec", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });

    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(client.launchRun).toHaveBeenCalledWith({ specPath: "/evals/compare.json" });
  });

  it("notes-only collapses to annotated files with their notes", async () => {
    const client = fakeEvalClient();
    client.getReviews = async () => ({
      schema: "eval.reviews.v1",
      variants: { "task/empty": { notes: [{ id: "n1", artifactId: "code:src/foo.ts", artifactLabel: "src/foo.ts", line: 2, snippet: "return 1", sentiment: "bad", text: "wrong base case", ts: 1 }] } }
    });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click(await screen.findByRole("button", { name: "Notes only" }));
    expect(screen.getByText("wrong base case")).toBeInTheDocument();
    // The prompt row (no notes) is gone in notes-only.
    expect(screen.queryByText("Task prompt")).toBeNull();
  });
});

/** Creates a deterministic client for app rendering tests. */
function fakeEvalClient(overrides?: { artifacts?: EvalCompareView["artifacts"]; codeDiff?: EvalDiffView }): EvalUiClient {
  /** Builds a deterministic output-metrics summary for a variant. */
  const metrics = (durationMs: number, peak: number): EvalVariantMetricsView => ({
    durationMs,
    activeAgentDurationMs: durationMs,
    tokensTotal: peak * 2,
    peakContextTokens: peak,
    filesChanged: 1,
    diffStat: "1 file changed",
    conversationIds: ["conv-1"],
    sparkline: { durationMs, tokensTotal: peak, buckets: [{ kind: "assistant", tokenShare: 1, durationShare: 1 }] }
  });
  const run: EvalRunDetailView = {
    id: "run1",
    name: "ui-compare",
    createdAt: "2026-06-16T10:00:00.000Z",
    runDir: "/tmp/run1",
    variantCount: 2,
    caseCount: 1,
    statuses: { prepared: 0, running: 0, done: 2, failed: 0, manual: 0, cancelled: 0 },
    cases: [{
      id: "task",
      variants: [{
        caseId: "task",
        variantId: "empty",
        label: "task/empty",
        status: "done",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "empty" },
        branch: "eval/run1/task/empty",
        worktree: "/tmp/empty",
        executionCwd: "/tmp/empty",
        baseCommit: "base",
        contextCommit: "empty-context",
        phases: [{ id: "implement", status: "done" }],
        promptArtifacts: [],
        metrics: metrics(12000, 42000),
        warnings: []
      }, {
        caseId: "task",
        variantId: "repo",
        label: "task/repo",
        status: "done",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "repo" },
        branch: "eval/run1/task/repo",
        worktree: "/tmp/repo",
        executionCwd: "/tmp/repo",
        baseCommit: "base",
        contextCommit: "repo-context",
        phases: [{ id: "implement", status: "done" }],
        promptArtifacts: [],
        metrics: metrics(9000, 51000),
        warnings: []
      }]
    }]
  };
  const compare: EvalCompareView = {
    run,
    caseId: "task",
    left: run.cases[0].variants[0],
    right: run.cases[0].variants[1],
    artifacts: overrides?.artifacts ?? [
      { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "changed" },
      { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" },
      { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true }
    ]
  };
  const promptDiff: EvalDiffView = {
    artifact: compare.artifacts[0],
    left: { variantId: "empty", label: "task/empty" },
    right: { variantId: "repo", label: "task/repo" },
    lines: [{ kind: "changed", leftNumber: 1, rightNumber: 1, left: "Use no context.", right: "Use repo context." }]
  };
  const contextDiff: EvalDiffView = {
    artifact: compare.artifacts[1],
    left: { variantId: "empty", label: "task/empty" },
    right: { variantId: "repo", label: "task/repo" },
    lines: [{ kind: "add", rightNumber: 1, right: "repo context" }]
  };
  return {
    /** Returns the seeded selected run. */
    getSelection: async () => ({ runId: "run1" }),
    /** Returns the seeded run list. */
    listRuns: async () => ({ runs: [run] }),
    /** Returns the seeded launchable specs. */
    listSpecs: async () => ({ specs: [{ path: "/evals/compare.json", name: "compare", caseCount: 1, variantCount: 2 }] }),
    /** Returns the seeded editable prompts. */
    getSpecPrompts: async (specPath) => ({ specPath, name: "compare", prompts: [{ id: "prompts/task.md", label: "Task prompt", path: "prompts/task.md", content: "Do the task." }] }),
    /** Echoes the saved prompt. */
    saveSpecPrompt: vi.fn(async ({ specPath, promptPath, content }) => ({ specPath, name: "compare", prompts: [{ id: promptPath, label: "Task prompt", path: promptPath, content }] })),
    /** Records launch requests. */
    launchRun: vi.fn(async () => ({ runId: "run1" })),
    /** Returns the seeded run detail. */
    getRun: async () => run,
    /** Returns the seeded comparison view. */
    compareRun: async () => compare,
    /** Returns the seeded diff for the requested artifact kind, with an artifact descriptor matching the request. */
    getDiff: vi.fn(async (args) => {
      const seed = args.kind === "context" ? contextDiff : args.kind === "code" && overrides?.codeDiff ? overrides.codeDiff : promptDiff;
      return { ...seed, artifact: { ...seed.artifact, id: `${args.kind}:${args.path}`, kind: args.kind, path: args.path } };
    }),
    /** Returns empty reviews. */
    getReviews: async () => ({ schema: "eval.reviews.v1" as const, variants: {} }),
    /** Echoes persisted reviews. */
    putReviews: vi.fn(async (_runId, reviews) => reviews)
  };
}
