import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, test, vi } from "vitest";

import "@testing-library/jest-dom/vitest";
import App from "./App.svelte";
import type { ProgramView, ReviewedRun, WorkApiClient } from "./client.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("starts the default Reviewed build from one Goal action", async () => {
  const run = fixtureRun("running");
  const starts: Parameters<WorkApiClient["startRun"]>[0][] = [];
  const startRun: WorkApiClient["startRun"] = vi.fn(async (input) => { starts.push(input); return { run }; });
  const client = fixtureClient({ startRun, runs: [] });

  render(App, { client });

  expect(await screen.findByRole("heading", { name: "Finish the widget" })).toBeInTheDocument();
  const start = screen.getByRole("button", { name: "Run reviewed build" });
  expect(screen.queryByLabelText("Reviewed build step choices")).not.toBeInTheDocument();
  await fireEvent.click(start);

  await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
  expect(starts[0]?.goalPath).toBe("otto/widget/goal-finish-widget.md");
  expect(starts[0]?.bindings.design.label).toBe("Claude Fable");
  expect(await screen.findByRole("heading", { name: "Agents are working" })).toBeInTheDocument();
  expect(screen.getByText("Create the design")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
});

test("reveals optional step choices without making them part of the start path", async () => {
  render(App, { client: fixtureClient() });

  await screen.findByRole("heading", { name: "Finish the widget" });
  await fireEvent.click(screen.getByRole("button", { name: "Review 8 steps" }));

  const editor = screen.getByLabelText("Reviewed build step choices");
  expect(editor).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save as Area defaults" })).toBeInTheDocument();
  expect(editor.querySelectorAll(".setup-step.editable")).toHaveLength(8);
});

test("shows a judgment question, direct artifact link, and answer-and-resume action", async () => {
  const run = fixtureRun("needs_attention");
  run.currentStepId = "design-review";
  run.attention = {
    kind: "judgment",
    stepId: "design-review",
    message: "The API name needs a choice.",
    question: "Should this be called Build or Program?",
    artifactPaths: ["docs/design-review.md"],
    at: new Date().toISOString()
  };
  run.steps[0].status = "complete";
  run.steps[1].status = "needs_attention";
  run.steps[1].attempts = [{
    id: "design-review-1",
    number: 1,
    status: "needs_attention",
    startedAt: new Date().toISOString(),
    artifacts: [{ path: "docs/design-review.md", purpose: "design-review", hash: "abc", stepId: "design-review", attempt: 1 }],
    proof: [],
    changedPaths: ["docs/design-review.md"],
    envelope: { status: "needs_judgment", summary: "Needs a name.", question: "Should this be called Build or Program?" }
  }];
  const controlRun = vi.fn(async () => ({ run: fixtureRun("running") }));
  render(App, { client: fixtureClient({ runs: [run], controlRun }) });

  expect(await screen.findByText("Should this be called Build or Program?")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /design-review.*docs\/design-review\.md/ });
  expect(link).toHaveAttribute("href", `/api/work/runs/${run.id}/artifacts/design-review/1/0`);
  const decision = screen.getByLabelText("Decision");
  await fireEvent.input(decision, { target: { value: "Use Program." } });
  await fireEvent.click(screen.getByRole("button", { name: "Answer and resume" }));

  await waitFor(() => expect(controlRun).toHaveBeenCalledWith(run.id, { action: "resume", decision: "Use Program." }));
});

/** Creates a complete fake API client with optional method overrides. */
function fixtureClient(overrides: Partial<WorkApiClient> & { runs?: ReviewedRun[] } = {}): WorkApiClient {
  const runs = overrides.runs || [];
  const client: WorkApiClient = {
    /** Lists the fixture Goals. */
    listGoals: async () => ({ goals: [{
      path: "otto/widget/goal-finish-widget.md",
      areaPath: "otto/widget",
      title: "Finish the widget",
      status: "open",
      doneWhen: "A finished widget has reviewed code and proof.",
      repository: "/tmp/widget"
    }] }),
    /** Returns the fixture Program. */
    getProgram: async () => fixtureProgram(),
    /** Lists the fixture Runs. */
    listRuns: async () => ({ runs }),
    /** Returns one fixture Run. */
    getRun: async (runId) => ({ run: runs.find((run) => run.id === runId) || fixtureRun("running"), latestOutput: "agent is reading the design" }),
    /** Starts one fixture Run. */
    startRun: async () => ({ run: fixtureRun("running") }),
    /** Updates one fixture step. */
    updateStep: async (_runId, _stepId, _input) => ({ run: fixtureRun("running") }),
    /** Applies one fixture Run control. */
    controlRun: async () => ({ run: fixtureRun("running") }),
    /** Saves fixture Area defaults. */
    saveDefaults: async () => ({}),
    ...overrides
  };
  return client;
}

/** Creates the eight-step Program view used by UI tests. */
function fixtureProgram(): ProgramView {
  const labels = [
    "Create the design",
    "Review the design",
    "Respond and plan",
    "Review the implementation plan",
    "Respond to the plan review",
    "Implement",
    "Review the implementation",
    "Respond and fix"
  ];
  const ids = ["design", "design-review", "respond-and-plan", "plan-review", "respond-to-plan-review", "implement", "implementation-review", "respond-and-fix"];
  const steps = ids.map((id, index) => ({
    id,
    order: index + 1,
    label: labels[index],
    instruction: `Do step ${index + 1}.`,
    defaultBinding: index % 2 === 0 ? "claude" as const : "codex" as const,
    requiredArtifacts: [],
    review: id.includes("review")
  }));
  return {
    id: "reviewed-build",
    name: "Reviewed build",
    version: 1,
    description: "A reviewed build.",
    steps,
    bindings: Object.fromEntries(steps.map((step) => [step.id, step.defaultBinding === "claude"
      ? { id: "claude-fable", label: "Claude Fable", provider: "claude", command: "claude", model: "fable" }
      : { id: "codex-max", label: "Codex Max", provider: "codex", command: "codex", effort: "max" }])),
    sessions: Object.fromEntries(steps.map((step) => [step.id, { mode: "fresh" }]))
  };
}

/** Creates one Run with the full ordered step list. */
function fixtureRun(status: ReviewedRun["status"]): ReviewedRun {
  const program = fixtureProgram();
  return {
    id: "20260814-reviewed",
    status,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:01:00.000Z",
    areaPath: "otto/widget",
    goalPath: "otto/widget/goal-finish-widget.md",
    goalTitle: "Finish the widget",
    goalDoneWhen: "A finished widget has reviewed code and proof.",
    repository: { root: "/tmp/widget", head: "1234567890abcdef", branch: "main", baseline: {} },
    currentStepId: status === "complete" ? undefined : "design",
    steps: program.steps.map((step) => ({
      ...step,
      status: "pending",
      binding: program.bindings[step.id],
      session: program.sessions[step.id],
      attempts: []
    }))
  };
}
