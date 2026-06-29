import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { EvalCompareView, EvalDiffView, EvalRunDetailView, EvalUiClient, EvalVariantMetricsView } from "./client.js";

afterEach(() => cleanup());

describe("eval svelte app", () => {
  it("renders run selection, variant metadata, output comparison, artifacts, and diff rows", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });

    expect(await screen.findByText(/ui-compare/)).toBeInTheDocument();
    // Individual review opens on the agent's work: the changed code file is selected, not the prompt.
    expect(await screen.findByRole("button", { name: /src\/foo.ts changed/ })).toHaveClass("active");
    // Individual review is the default mode; the A/B line diff lives behind the Side by side tab.
    await fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(container.querySelectorAll(".entity select")).toHaveLength(2);
    // Code defaults to the split (read both outputs) layout: A shows this variant's text, B the other's.
    expect(await screen.findByText("Use repo context.")).toBeInTheDocument();
    expect(container.querySelector(".reader-col code")).toHaveTextContent("Use no context.");

    // Each config's metrics surface as a flame caption (duration / tokens / peak context).
    expect(container.querySelector(".flame-caption")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /src\/foo.ts changed/ })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /AGENTS.md right-only/ }));

    expect(client.getDiff).toHaveBeenLastCalledWith({
      runId: "run1",
      caseId: "task",
      left: "empty",
      right: "repo",
      kind: "context",
      path: "AGENTS.md"
    });
  });

  it("defaults to Review mode and synthesizes a Compare view from notes", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });

    // Individual review is the default mode, with a chip per reviewed config.
    expect(await screen.findByRole("button", { name: "Individual" })).toHaveClass("active");
    expect(container.querySelector(".variant-chip")).toBeInTheDocument();

    // Compare notes synthesizes one column per config (A/B) with Did well / Mistakes groups.
    await fireEvent.click(screen.getByRole("button", { name: "Compare notes" }));
    expect(container.querySelectorAll(".review-col")).toHaveLength(2);
    expect(screen.getAllByText(/Did well/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mistakes/).length).toBeGreaterThan(0);
  });

  it("reviews a variant using only artifacts present in it, never auto-selecting one absent from it", async () => {
    // The empty-context variant is reviewed by default. Its only changed artifact relative to the repo
    // variant is a code file; the context files are right-only (they exist solely in the repo variant).
    // The review pane must load the present code artifact, not the right-only context file (which 404s).
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" },
        { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true }
      ]
    });
    const { container } = render(App, { props: { client } });

    // The pane loads content for an artifact that exists in the reviewed variant, scoped to it (left === right).
    await screen.findByRole("button", { name: /src\/foo.ts changed/ });
    expect(client.getDiff).toHaveBeenCalled();
    const lastCall = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ left: "empty", right: "empty" });
    expect(lastCall.path).not.toBe("AGENTS.md");

    // Individual code review renders the agent's change as a unified diff (old line above the new), not the whole file.
    await screen.findByText("Use repo context.");
    expect(container.querySelector(".review-reader")).toHaveClass("review-diff");
    expect(container.querySelector(".review-delete code")).toHaveTextContent("Use no context.");
    expect(container.querySelector(".review-changed code")).toHaveTextContent("Use repo context.");

    // The right-only context file is not offered while reviewing the variant it is absent from.
    expect(screen.queryByRole("button", { name: /AGENTS.md/ })).toBeNull();

    // Switching the reviewed variant to the one the context file belongs to surfaces it in the list.
    await fireEvent.click(screen.getByRole("button", { name: "repo" }));
    expect(await screen.findByRole("button", { name: /AGENTS.md right-only/ })).toBeInTheDocument();
  });

  it("lists only the files the reviewed variant changed, not files only the other variant touched", async () => {
    // src/theirs.ts differs between the two outputs (so its pair status is "changed"), but only the repo
    // variant's agent changed it. Reviewing the empty variant must not offer it: there is nothing to review.
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "code:src/mine.ts", kind: "code", path: "src/mine.ts", label: "src/mine.ts", status: "changed", changedLeft: true, changedRight: false },
        { id: "code:src/theirs.ts", kind: "code", path: "src/theirs.ts", label: "src/theirs.ts", status: "changed", changedLeft: false, changedRight: true }
      ]
    });
    const { container } = render(App, { props: { client } });

    // The reviewed (empty) variant's own change is offered and auto-selected; the other variant's file is not listed.
    expect(await screen.findByRole("button", { name: /src\/mine.ts/ })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: /src\/theirs.ts/ })).toBeNull();
    // No "this config made no changes" dead-end.
    expect(container.querySelector(".review-reader .state")).toBeNull();

    // Switching to the repo variant flips which file is in scope.
    await fireEvent.click(screen.getByRole("button", { name: "repo" }));
    expect(await screen.findByRole("button", { name: /src\/theirs.ts/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /src\/mine.ts/ })).toBeNull();
  });

  it("ignores a stale in-flight review diff when the reviewed variant changes", async () => {
    // src/a.ts belongs to the empty variant, src/b.ts to the repo variant. Switching from empty to repo
    // leaves the empty request in flight; if it resolves last it must not overwrite the repo diff.
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "code:src/a.ts", kind: "code", path: "src/a.ts", label: "src/a.ts", status: "changed", changedLeft: true, changedRight: false },
        { id: "code:src/b.ts", kind: "code", path: "src/b.ts", label: "src/b.ts", status: "changed", changedLeft: false, changedRight: true }
      ]
    });
    const pending: { left: string; path: string; resolve: (view: EvalDiffView) => void }[] = [];
    /** Builds a one-line added-code diff view for a review-mode artifact. */
    const diffFor = (path: string, body: string): EvalDiffView => ({
      artifact: { id: `code:${path}`, kind: "code", path, label: path, status: "changed" },
      left: { variantId: "x", label: "x" },
      right: { variantId: "x", label: "x" },
      lines: [{ kind: "add", rightNumber: 1, right: body }]
    });
    client.getDiff = vi.fn((args) => new Promise<EvalDiffView>((resolve) => pending.push({ left: args.left, path: args.path, resolve })));
    render(App, { props: { client } });

    // Reviewing empty auto-selects src/a.ts; switching to repo auto-selects src/b.ts. Both diffs are in flight.
    await screen.findByRole("button", { name: /src\/a.ts/ });
    await fireEvent.click(screen.getByRole("button", { name: "repo" }));
    await screen.findByRole("button", { name: /src\/b.ts/ });

    // While the diff is in flight the pane shows a loading state, not the previous file's content.
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // Resolve the current (repo/src/b.ts) request first, then the stale (empty/src/a.ts) one.
    pending.filter((p) => p.left === "repo").forEach((p) => p.resolve(diffFor("src/b.ts", "B body")));
    expect(await screen.findByText("B body")).toBeInTheDocument();
    pending.filter((p) => p.left === "empty").forEach((p) => p.resolve(diffFor("src/a.ts", "A body")));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The stale empty-variant diff must not replace the repo diff on screen.
    expect(screen.queryByText("A body")).toBeNull();
    expect(screen.getByText("B body")).toBeInTheDocument();
  });

  it("collapses unchanged code in Individual review so the agent's edit is the focus", async () => {
    // A long file the agent barely touched: 40 unchanged lines, one added line, 40 more unchanged.
    const lines = [
      ...Array.from({ length: 40 }, (_unused, i) => ({ kind: "equal" as const, leftNumber: i + 1, rightNumber: i + 1, left: `keep ${i}`, right: `keep ${i}` })),
      { kind: "add" as const, rightNumber: 41, right: "the one new line" },
      ...Array.from({ length: 40 }, (_unused, i) => ({ kind: "equal" as const, leftNumber: i + 41, rightNumber: i + 42, left: `keep ${i + 40}`, right: `keep ${i + 40}` }))
    ];
    const codeDiff: EvalDiffView = {
      artifact: { id: "code:src/big.ts", kind: "code", path: "src/big.ts", label: "src/big.ts", status: "changed" },
      left: { variantId: "empty", label: "task/empty" },
      right: { variantId: "empty", label: "task/empty" },
      lines
    };
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "code:src/big.ts", kind: "code", path: "src/big.ts", label: "src/big.ts", status: "changed", changedLeft: true, changedRight: true }
      ],
      codeDiff
    });
    const { container } = render(App, { props: { client } });

    // The added line is shown; the 80 unchanged lines are collapsed behind expandable gaps rather than all rendered.
    expect(await screen.findByText("the one new line")).toBeInTheDocument();
    expect(container.querySelectorAll(".diff-gap").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".review-row").length).toBeLessThan(20);

    // Expanding a gap reveals the unchanged lines it hid.
    await fireEvent.click(container.querySelector(".diff-gap") as HTMLElement);
    expect(container.querySelectorAll(".review-row").length).toBeGreaterThan(20);
  });

  it.todo("scores a specific variant by key, not just the reviewed one");

  it("launches a run from the selected spec", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });

    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(client.launchRun).toHaveBeenCalledWith({ specPath: "/evals/compare.json" });
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
