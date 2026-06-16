import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { EvalCompareView, EvalDiffView, EvalRunDetailView, EvalUiClient } from "./client.js";

afterEach(() => cleanup());

describe("eval svelte app", () => {
  it("renders run selection, variant metadata, artifacts, and diff rows", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });

    expect(await screen.findByRole("button", { name: /ui-compare/ })).toHaveClass("active");
    expect(await screen.findAllByText("codex-cli / fake")).toHaveLength(2);
    expect(screen.getByLabelText("Compare configurations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Task prompt changed/ })).toHaveClass("active");
    expect(await screen.findByText("Use repo context.")).toBeInTheDocument();
    expect(container.querySelector(".diff-row.changed")).toHaveTextContent("Use no context.");

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
});

/** Creates a deterministic client for app rendering tests. */
function fakeEvalClient(): EvalUiClient {
  const run: EvalRunDetailView = {
    id: "run1",
    name: "ui-compare",
    createdAt: "2026-06-16T10:00:00.000Z",
    runDir: "/tmp/run1",
    variantCount: 2,
    caseCount: 1,
    statuses: { prepared: 1, running: 0, done: 0, failed: 0, manual: 0, cancelled: 0 },
    cases: [{
      id: "task",
      variants: [{
        caseId: "task",
        variantId: "empty",
        label: "task/empty",
        status: "prepared",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "empty" },
        branch: "eval/run1/task/empty",
        worktree: "/tmp/empty",
        executionCwd: "/tmp/empty",
        baseCommit: "base",
        contextCommit: "empty-context",
        promptArtifacts: [],
        warnings: []
      }, {
        caseId: "task",
        variantId: "repo",
        label: "task/repo",
        status: "prepared",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "repo" },
        branch: "eval/run1/task/repo",
        worktree: "/tmp/repo",
        executionCwd: "/tmp/repo",
        baseCommit: "base",
        contextCommit: "repo-context",
        promptArtifacts: [],
        warnings: []
      }]
    }]
  };
  const compare: EvalCompareView = {
    run,
    caseId: "task",
    left: run.cases[0].variants[0],
    right: run.cases[0].variants[1],
    artifacts: [
      { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "changed" },
      { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" }
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
    /** Returns the seeded run detail. */
    getRun: async () => run,
    /** Returns the seeded comparison view. */
    compareRun: async () => compare,
    /** Returns the seeded diff matching the requested artifact kind. */
    getDiff: vi.fn(async (args) => args.kind === "context" ? contextDiff : promptDiff)
  };
}
