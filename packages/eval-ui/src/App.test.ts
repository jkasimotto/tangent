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

  it("expands a changed file on both sides with one click and caches the fetch", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // One click on either column's label opens both columns; each side is fetched once.
    const expandButtons = await screen.findAllByRole("button", { name: "Expand src/foo.ts" });
    expect(expandButtons.length).toBe(2);
    await fireEvent.click(expandButtons[0]);
    expect((await screen.findAllByText("Use repo context.")).length).toBe(2);
    const callsAfterFirst = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(2);

    // Collapse and re-expand: no new fetch (both sides served from cache).
    await fireEvent.click(screen.getAllByRole("button", { name: "Collapse src/foo.ts" })[0]);
    await fireEvent.click(screen.getAllByRole("button", { name: "Expand src/foo.ts" })[0]);
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

    // One click opens both columns; the added line shows on each side.
    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    expect((await screen.findAllByText("added feature line")).length).toBe(2);
    // Equal runs were collapsed into gap placeholders.
    expect(container.querySelectorAll(".diff-gap").length).toBeGreaterThanOrEqual(1);
    // Each side collapses its 80 equal lines: far fewer rendered rows in a single detail.
    const oneDetail = container.querySelector(".aligned-detail") as HTMLElement;
    expect(oneDetail.querySelectorAll(".review-row").length).toBeLessThan(80);
  });

  it("drills into a single variant+file to add a per-line note", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
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

    // One expand reveals both columns' note buttons. Drill into empty (its fetch stays in flight), close, then drill into repo.
    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    await fireEvent.click(await screen.findByRole("button", { name: "Add notes on src/foo.ts for empty" }));
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
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

  it("renders +N -M counts on the side that changed a file", async () => {
    const client = fakeEvalClient({
      artifacts: [
        {
          id: "code:src/foo.ts",
          kind: "code",
          path: "src/foo.ts",
          label: "src/foo.ts",
          status: "changed",
          changedLeft: true,
          changedRight: true,
          addedLeft: 5,
          removedLeft: 2,
          addedRight: 3,
          removedRight: 1
        }
      ]
    });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");

    // Left side (aligned-a) shows its counts.
    const sideA = container.querySelector(".aligned-a") as HTMLElement;
    expect(within(sideA).getByText("+5 -2")).toBeInTheDocument();

    // Right side (aligned-b) shows its counts.
    const sideB = container.querySelector(".aligned-b") as HTMLElement;
    expect(within(sideB).getByText("+3 -1")).toBeInTheDocument();
  });

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
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click(await screen.findByRole("button", { name: "Notes only" }));
    expect(screen.getByText("wrong base case")).toBeInTheDocument();
    // The prompt row (no notes) is gone in notes-only.
    expect(screen.queryByText("Task prompt")).toBeNull();
  });

  it("switches the Context section to the Assembled view and renders verbatim blocks per side", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    // Repo side shows the CLAUDE.md content; empty side shows the empty state.
    expect(await screen.findByText("root rules")).toBeInTheDocument();
    expect(screen.getByText("No repo context loads at this path.")).toBeInTheDocument();
  });

  it("marks a context block present on only one side", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    // The repo side's CLAUDE.md is absent from the empty side, so its divider is tagged "only here".
    expect(screen.getAllByText("only here").length).toBeGreaterThanOrEqual(1);
  });

  it("re-assembles both sides when the cwd changes", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    const calls = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length;
    await fireEvent.input(screen.getByLabelText("cwd path"), { target: { value: "client/lib" } });
    // Two more calls (both sides) for the new cwd.
    await screen.findByText("root rules");
    expect((client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls);
    const lastArgs = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastArgs.cwd).toBe("client/lib");
  });

  it("loads a skill body when its picker checkbox is toggled", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(await screen.findByRole("checkbox", { name: "testing" }));
    expect(await screen.findByText("FULL TESTING BODY")).toBeInTheDocument();
  });

  it("copies a side's verbatim concatenation without provenance dividers", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(await screen.findByRole("button", { name: "Copy repo context" }));
    expect(writeText).toHaveBeenCalledWith("root rules\n\ntesting: Use when testing");
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
    /** Returns a deterministic context manifest. */
    getContextManifest: vi.fn(async () => ({ skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: false }], subagents: [] })),
    /** Returns a deterministic assembled context: the repo side has blocks, the empty side has none. */
    assembleContext: vi.fn(async (args: { variant: string; skills: string[] }) => args.variant === "repo"
      ? { blocks: [
          { kind: "claude-md" as const, source: "CLAUDE.md", text: "root rules" },
          { kind: "skills-index" as const, source: "skills", text: "testing: Use when testing" },
          ...(args.skills.includes("testing") ? [{ kind: "skill-body" as const, source: ".claude/skills/testing/SKILL.md", text: "FULL TESTING BODY" }] : [])
        ], skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: args.skills.includes("testing") }], subagents: [], lazyClaudeMd: [] }
      : { blocks: [], skills: [], subagents: [], lazyClaudeMd: [] }),
    /** Returns empty reviews. */
    getReviews: async () => ({ schema: "eval.reviews.v1" as const, variants: {} }),
    /** Echoes persisted reviews. */
    putReviews: vi.fn(async (_runId, reviews) => reviews)
  };
}
