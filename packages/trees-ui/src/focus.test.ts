import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "./App.svelte";
import type { TreesUiClient, TreesUiWorkspace } from "./client.js";
import {
  isDue, projectFocus,
  type AgentStatus, type FocusClient, type FocusEvent, type StartTaskInput, type Task
} from "./focus-client.js";

afterEach(() => cleanup());

// --- Click budget: action-cost goals (B1) assert the minimal flow reaches the
// asserted end state. fireEvent.input (typing) and fireEvent.submit (Enter) are
// not clicks; only click() counts. ---
let clicks = 0;
beforeEach(() => { clicks = 0; });
/** Clicks an element, counting it against the action-cost budget. */
async function click(element: Element): Promise<void> {
  clicks += 1;
  await fireEvent.click(element);
}

/** Pure projection assertions (B3) need no DOM. */
describe("focus projection invariants", () => {
  const base = 1_700_000_000_000;
  let clock = base;
  /** Monotonic clock for deterministic event timestamps. */
  const at = () => ++clock;
  /** Events that start and focus a task. */
  function startEvents(taskId: string, entity: string, estimateMin = 30): FocusEvent[] {
    return [
      { type: "task_started", ts: at(), taskId, entity, intent: `do ${taskId}`, estimateMin },
      { type: "focus_on", ts: at(), taskId }
    ];
  }

  it("G13: at most one task is in focus at any instant", () => {
    const events: FocusEvent[] = [...startEvents("a", "x"), ...startEvents("b", "y")];
    const state = projectFocus(events, clock + 1000);
    expect(state.tasks.filter((t) => t.status === "focus")).toHaveLength(1);
    expect(state.focusId).toBe("b");
  });

  it("G14: no parked/watching task lacks a return-time", () => {
    const events: FocusEvent[] = [
      ...startEvents("a", "x"),
      { type: "focus_off", ts: at(), taskId: "a" },
      { type: "checkin_set", ts: at(), taskId: "a", dueAt: clock + 1_000_000 },
      ...startEvents("b", "y"),
      { type: "agent_dispatched", ts: at(), taskId: "b", adapter: "claude", cwd: "/w", transcriptDir: "/t/b" }
    ];
    const state = projectFocus(events, clock + 1000);
    for (const task of state.tasks) {
      if (task.status === "parked") expect(task.checkinAt).toBeTypeOf("number");
      if (task.status === "watching") expect(task.agent).toBeTruthy();
    }
  });

  it("G15: three switches count as three", () => {
    // First focus is not a switch; a->b, b->c, c->a are three switches.
    const full: FocusEvent[] = [
      ...startEvents("a", "x"),
      ...startEvents("b", "y"),
      ...startEvents("c", "z"),
      { type: "focus_on", ts: at(), taskId: "a" }
    ];
    const state = projectFocus(full, clock + 1000);
    expect(state.switchCountToday).toBe(3);
  });

  it("G16: a task's focus segments sum to its attributed time", () => {
    const t0 = at();
    const events: FocusEvent[] = [
      { type: "task_started", ts: t0, taskId: "a", entity: "x", intent: "do a", estimateMin: 30 },
      { type: "focus_on", ts: t0 + 60_000, taskId: "a" },
      { type: "focus_off", ts: t0 + 180_000, taskId: "a" } // 2 minutes
    ];
    const state = projectFocus(events, clock + 1000);
    const task = state.tasks.find((t) => t.id === "a")!;
    const totalMs = task.segments.reduce((sum, s) => sum + ((s.off ?? 0) - s.on), 0);
    expect(totalMs).toBe(120_000);
  });

  it("G17: a done task exposes estimate and wall-clock actual", () => {
    const t0 = at();
    const events: FocusEvent[] = [
      { type: "task_started", ts: t0, taskId: "a", entity: "x", intent: "do a", estimateMin: 30 },
      { type: "focus_on", ts: t0, taskId: "a" },
      { type: "task_done", ts: t0 + 45 * 60_000, taskId: "a", note: "shipped" }
    ];
    const task = projectFocus(events, clock + 1000).tasks.find((t) => t.id === "a")!;
    expect(task.estimateMin).toBe(30);
    expect(task.actualMin).toBe(45);
  });

  it("isDue is true only for passed check-ins or agents needing you (G12 quiet running)", () => {
    const now = clock + 1000;
    const running: Task = baseTask({ status: "watching", agent: { adapter: "claude", cwd: "/w", status: "running" } });
    const done: Task = baseTask({ status: "watching", agent: { adapter: "claude", cwd: "/w", status: "done" } });
    const overdue: Task = baseTask({ status: "parked", checkinAt: now - 1 });
    const future: Task = baseTask({ status: "parked", checkinAt: now + 1_000_000 });
    expect(isDue(running, now)).toBe(false);
    expect(isDue(done, now)).toBe(true);
    expect(isDue(overdue, now)).toBe(true);
    expect(isDue(future, now)).toBe(false);
  });
});

/** UI action-cost + visibility goals (B1, B2) driving the real component. */
describe("command and control UI", () => {
  it("G1: starts a focused task with zero clicks and one Enter", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });

    await typeCommand("eval", "speed up compare", "30");
    await fireEvent.submit(screen.getByLabelText("Start a task")); // the Enter

    const focusRegion = await screen.findByLabelText("Focus");
    expect(within(focusRegion).getByRole("heading", { name: "speed up compare" })).toBeInTheDocument();
    expect(clicks).toBe(0);
  });

  it("G7/G13: exactly one dominant Focus region, one task in focus", async () => {
    const focus = fakeFocus();
    const { container } = render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "investigate", "60");

    expect(container.querySelectorAll(".focus-zone")).toHaveLength(1);
    expect(projectFocus(focus.events, Date.now()).tasks.filter((t) => t.status === "focus")).toHaveLength(1);
  });

  it("G2/G14: switch to a new task parks the old one with a check-in (<= 2 clicks)", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "first", "30");

    // Switch: just type the new task and Enter. No clicks needed; old task auto-parks.
    await typeCommand("docs", "second", "30");
    await fireEvent.submit(screen.getByLabelText("Start a task"));
    await screen.findByRole("heading", { name: "second" });

    const state = projectFocus(focus.events, Date.now());
    const parked = state.tasks.find((t) => t.intent === "first")!;
    expect(parked.status).toBe("parked");
    expect(parked.checkinAt).toBeTypeOf("number"); // no limbo
    expect(clicks).toBeLessThanOrEqual(2);
  });

  it("G5/G11: mark done in <= 2 clicks and show the bet result", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "fix bug", "30");

    await click(screen.getByRole("button", { name: "Done" }));

    const result = await screen.findByLabelText("Bet result");
    expect(result).toHaveTextContent(/predicted/i);
    expect(result).toHaveTextContent(/took/i);
    expect(clicks).toBeLessThanOrEqual(2);
  });

  it("G3: dispatching an agent keeps the task focused and attaches a transcript link", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "build ui", "120");

    await click(screen.getByRole("button", { name: "Dispatch agent" }));
    // Stays focused: the agent runs in the background; the task is NOT moved to Incoming.
    await screen.findByRole("button", { name: "Agent running" });

    const state = projectFocus(focus.events, Date.now());
    const task = state.tasks.find((t) => t.intent === "build ui")!;
    expect(state.focusId).toBe(task.id);
    expect(task.status).toBe("focus");
    expect(task.agent?.transcriptDir).toBeTruthy();
    expect(state.incoming.find((t) => t.id === task.id)).toBeUndefined();
  });

  it("G9: a parked task appears in Waiting with a check-in countdown", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "first", "30");
    await startTaskUI("docs", "second", "30"); // parks "first" with a default check-in

    const incoming = await screen.findByLabelText("Incoming");
    expect(incoming).toHaveTextContent("eval · first");
    expect(incoming).toHaveTextContent(/check in/);
  });

  it("G4/G10/G12: a due agent raises a check-in band; running stays quiet; focusing it is one click", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "agent task", "60");
    await click(screen.getByRole("button", { name: "Dispatch agent" }));
    clicks = 0;
    await startTaskUI("docs", "other work", "30");

    const taskId = focus.events.find((e) => e.type === "agent_dispatched")!.taskId;

    // G12: running agent shows no check-in band.
    focus.setStatus(taskId, "running");
    await tickPoll();
    expect(screen.queryByLabelText("Check-in due")).toBeNull();

    // G10: a done agent raises the band.
    focus.setStatus(taskId, "done");
    await tickPoll();
    const band = await screen.findByLabelText("Check-in due");
    expect(band).toBeInTheDocument();

    // G4: one click makes it the focus.
    clicks = 0;
    await click(within(band).getByRole("button", { name: "Make this my focus" }));
    await screen.findByRole("heading", { name: "agent task" });
    expect(clicks).toBe(1);
  });

  it("done with unknown finish records no actual (the walk-away case)", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "long task", "30");

    await click(screen.getByRole("button", { name: "Done · don't know when" }));

    const result = await screen.findByLabelText("Bet result");
    expect(result).toHaveTextContent(/time unknown/i);
    const task = projectFocus(focus.events, Date.now()).tasks.find((t) => t.intent === "long task")!;
    expect(task.status).toBe("done");
    expect(task.actualMin).toBeUndefined();
  });

  it("G6: rolling up an entity surfaces its note text", async () => {
    const focus = fakeFocus();
    render(App, { props: { client: treesClient(), focus } });
    await startTaskUI("eval", "investigate", "60");

    await fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "found N+1 in loader" } });
    await click(screen.getByRole("button", { name: "Add note" }));
    clicks = 0;
    await click(screen.getByRole("button", { name: "Roll up" }));

    const rollup = await screen.findByLabelText("Rollup");
    expect(rollup).toHaveTextContent("found N+1 in loader");
    expect(clicks).toBe(1);
  });

  it("G8: the Trees view contains no agent or session nodes", async () => {
    const focus = fakeFocus();
    const { container } = render(App, { props: { client: treesClient(), focus, initialView: "trees" } });
    await screen.findByLabelText("Trees workspace");
    expect(container.querySelectorAll(".session-row")).toHaveLength(0);
    expect(container.querySelector(".focus-zone")).toBeNull();
  });
});

// --- helpers ---

/** Types entity, intent, and estimate into the command bar. */
async function typeCommand(entity: string, intent: string, minutes: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText("Entity"), { target: { value: entity } });
  await fireEvent.input(screen.getByLabelText("What are you doing"), { target: { value: intent } });
  await fireEvent.input(screen.getByLabelText("Estimate minutes"), { target: { value: minutes } });
}

/** Starts a task through the UI (setup; not counted against a specific goal's click budget). */
async function startTaskUI(entity: string, intent: string, minutes: string): Promise<void> {
  await typeCommand(entity, intent, minutes);
  await fireEvent.submit(screen.getByLabelText("Start a task"));
  await screen.findByRole("heading", { name: intent });
}

/** Forces a focus reload (the App reloads agent statuses after every action). */
async function tickPoll(): Promise<void> {
  await fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "." } });
  await fireEvent.click(screen.getByRole("button", { name: "Add note" }));
}

/** A minimal task for projection helper tests. */
function baseTask(overrides: Partial<Task>): Task {
  return {
    id: "t", entity: "x", intent: "i", estimateMin: 30, status: "parked",
    notes: [], startedAt: 0, segments: [], ...overrides
  };
}

/** A trees client with one configured entity, for the command-center UI tests. */
function treesClient(): TreesUiClient {
  const workspace: TreesUiWorkspace = {
    entities: [{ id: "ent_eval", path: "eval", title: "eval", kind: "work", projectId: "p1", branch: "main", worktreePath: "/repo/eval" }],
    projects: [{ id: "p1", name: "tangent", path: "/repo/eval" }]
  };
  return {
    /** Returns the fixed workspace. */
    loadWorkspace: async () => structuredClone(workspace),
    /** No-op create. */
    createPath: async () => structuredClone(workspace),
    /** No-op leaf save. */
    saveLeaf: async () => structuredClone(workspace),
    /** No-op leaf clear. */
    clearLeaf: async () => structuredClone(workspace),
    /** No-op delete. */
    deleteEntity: async () => structuredClone(workspace)
  };
}

/** In-memory FocusClient backed by the real event log + projection. */
function fakeFocus(): FocusClient & { events: FocusEvent[]; setStatus(id: string, s: AgentStatus): void } {
  const events: FocusEvent[] = [];
  const statuses: Record<string, AgentStatus> = {};
  let clock = Date.now();
  /** Monotonic clock for event timestamps. */
  const at = () => (clock += 1);
  let counter = 0;
  return {
    events,
    /** Sets a fake agent status for a task. */
    setStatus(id, s) { statuses[id] = s; },
    /** Returns a copy of the recorded events. */
    listEvents: async () => events.map((e) => ({ ...e })),
    /** Records task_started + focus_on. */
    startTask: async (input: StartTaskInput) => {
      const taskId = `task_${counter += 1}`;
      events.push({ type: "task_started", ts: at(), taskId, entity: input.entity, intent: input.intent, outcome: input.outcome, estimateMin: input.estimateMin });
      events.push({ type: "focus_on", ts: at(), taskId });
      return taskId;
    },
    /** Records focus_on. */
    focusOn: async (taskId) => { events.push({ type: "focus_on", ts: at(), taskId }); },
    /** Records focus_off and an optional check-in. */
    park: async (taskId, dueAt) => {
      events.push({ type: "focus_off", ts: at(), taskId });
      if (dueAt != null) events.push({ type: "checkin_set", ts: at(), taskId, dueAt });
    },
    /** Records note_added. */
    addNote: async (taskId, text) => { events.push({ type: "note_added", ts: at(), taskId, text }); },
    /** Records checkin_set. */
    setCheckin: async (taskId, dueAt) => { events.push({ type: "checkin_set", ts: at(), taskId, dueAt }); },
    /** Records agent_dispatched with a fake transcript dir. */
    dispatchAgent: async (taskId, adapter, cwd) => {
      events.push({ type: "agent_dispatched", ts: at(), taskId, adapter, cwd, transcriptDir: `/transcripts/${taskId}` });
    },
    /** Records task_done. */
    done: async (taskId, note, actualUnknown) => { events.push({ type: "task_done", ts: at(), taskId, note, actualUnknown }); },
    /** Records task_dropped. */
    drop: async (taskId, note) => { events.push({ type: "task_dropped", ts: at(), taskId, note }); },
    /** Returns fake statuses for watched tasks. */
    agentStatuses: async (tasks) => {
      const out: Record<string, AgentStatus> = {};
      for (const task of tasks) if (statuses[task.id]) out[task.id] = statuses[task.id];
      return out;
    }
  };
}
