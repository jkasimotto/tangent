// The command-and-control spine. One append-only event log; tasks, the daily
// timeline, switch count, and estimate-vs-actual are all projections over it.
// See docs/design/command-and-control.md.

export type AgentStatus = "running" | "waiting" | "done" | "unknown";

export type FocusEvent =
  | { type: "task_started"; ts: number; taskId: string; entity: string; intent: string; outcome?: string; estimateMin: number }
  | { type: "focus_on"; ts: number; taskId: string }
  | { type: "focus_off"; ts: number; taskId: string }
  | { type: "note_added"; ts: number; taskId: string; text: string }
  | { type: "checkin_set"; ts: number; taskId: string; dueAt: number }
  | { type: "agent_dispatched"; ts: number; taskId: string; adapter: string; cwd: string; transcriptDir?: string }
  | { type: "task_done"; ts: number; taskId: string; note?: string; actualUnknown?: boolean }
  | { type: "task_dropped"; ts: number; taskId: string; note?: string }
  // A break. Independent of tasks: a focused task's wall-clock keeps running through a rest by design
  // (break time is part of how long the work really took), so rest events never touch focus segments.
  | { type: "rest_started"; ts: number; durationMin: number }
  | { type: "rest_ended"; ts: number };

export type TaskStatus = "focus" | "parked" | "watching" | "done" | "dropped";

export interface FocusSegment {
  on: number;
  off?: number;
}

export interface Task {
  id: string;
  entity: string;
  intent: string;
  outcome?: string;
  estimateMin: number;
  status: TaskStatus;
  notes: string[];
  checkinAt?: number;
  agent?: { adapter: string; cwd: string; transcriptDir?: string; status: AgentStatus };
  startedAt: number;
  doneAt?: number;
  doneNote?: string;
  segments: FocusSegment[];
  /** Wall-clock minutes start -> done (the bet's actual). Undefined while open. */
  actualMin?: number;
}

export interface FocusState {
  tasks: Task[];
  focusId?: string;
  switchCountToday: number;
  incoming: Task[];
  /** The active break, if any. Set while a `rest_started` has no later `rest_ended`; stays set past `endsAt` (that is the "break's over, awaiting end" state). */
  rest?: { startedAt: number; endsAt: number };
}

/** A task is due (bidding to become focus) when its check-in has passed or its agent needs you. */
export function isDue(task: Task, now: number): boolean {
  if (task.status === "watching" && (task.agent?.status === "waiting" || task.agent?.status === "done")) return true;
  return task.checkinAt != null && task.checkinAt <= now;
}

/** Projects the event log into the current command-and-control state. Pure. */
export function projectFocus(events: FocusEvent[], now: number, statuses: Record<string, AgentStatus> = {}): FocusState {
  const tasks = new Map<string, Task>();
  const switchTimestamps: number[] = [];
  let currentFocus: string | undefined;
  let lastFocused: string | undefined;
  let activeRest: FocusState["rest"];

  /** Closes a task's currently-open focus segment at the given timestamp. */
  const closeSegment = (id: string, ts: number) => {
    const task = tasks.get(id);
    const open = task?.segments.at(-1);
    if (open && open.off == null) open.off = ts;
  };
  /** The status a task returns to when it loses focus: watching if it owns an agent, else parked. */
  const restingStatus = (task: Task): TaskStatus => (task.agent ? "watching" : "parked");

  for (const event of events) {
    // Rest is global (no taskId) and handled before the task switch so it never touches segments.
    if (event.type === "rest_started") { activeRest = { startedAt: event.ts, endsAt: event.ts + event.durationMin * 60000 }; continue; }
    if (event.type === "rest_ended") { activeRest = undefined; continue; }
    const task = tasks.get(event.taskId);
    switch (event.type) {
      case "task_started":
        tasks.set(event.taskId, {
          id: event.taskId,
          entity: event.entity,
          intent: event.intent,
          outcome: event.outcome,
          estimateMin: event.estimateMin,
          status: "parked",
          notes: [],
          startedAt: event.ts,
          segments: []
        });
        break;
      case "focus_on":
        if (!task) break;
        if (currentFocus && currentFocus !== event.taskId) {
          closeSegment(currentFocus, event.ts);
          const prev = tasks.get(currentFocus);
          if (prev) prev.status = restingStatus(prev);
        }
        if (lastFocused && lastFocused !== event.taskId) switchTimestamps.push(event.ts);
        currentFocus = event.taskId;
        lastFocused = event.taskId;
        task.status = "focus";
        task.checkinAt = undefined;
        task.segments.push({ on: event.ts });
        break;
      case "focus_off":
        if (!task) break;
        if (currentFocus === event.taskId) {
          closeSegment(event.taskId, event.ts);
          currentFocus = undefined;
        }
        task.status = restingStatus(task);
        break;
      case "note_added":
        if (task) task.notes.push(event.text);
        break;
      case "checkin_set":
        if (task) task.checkinAt = event.dueAt;
        break;
      case "agent_dispatched":
        if (!task) break;
        // Dispatching does NOT change focus. The agent runs in the background while
        // you keep working on the same task; it only leaves focus when you park or
        // switch (then restingStatus makes it "watching" so it can vie for attention).
        task.agent = { adapter: event.adapter, cwd: event.cwd, transcriptDir: event.transcriptDir, status: "unknown" };
        if (currentFocus !== event.taskId && task.status !== "done" && task.status !== "dropped") task.status = "watching";
        break;
      case "task_done":
      case "task_dropped":
        if (!task) break;
        if (currentFocus === event.taskId) {
          closeSegment(event.taskId, event.ts);
          currentFocus = undefined;
        }
        if (lastFocused === event.taskId) lastFocused = undefined;
        task.status = event.type === "task_done" ? "done" : "dropped";
        task.doneAt = event.ts;
        task.doneNote = event.note;
        // When the user marks done late (forgot, went for a walk), wall-clock is
        // meaningless, so actual is left unknown rather than recording a bogus number.
        task.actualMin = (event.type === "task_done" && event.actualUnknown)
          ? undefined
          : Math.max(1, Math.round((event.ts - task.startedAt) / 60000));
        break;
    }
  }

  for (const task of tasks.values()) {
    if (task.agent && statuses[task.id]) task.agent.status = statuses[task.id];
  }

  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const all = [...tasks.values()];
  const incoming = all
    .filter((task) => task.status === "parked" || task.status === "watching")
    .sort((a, b) => {
      const aDue = isDue(a, now) ? 0 : 1;
      const bDue = isDue(b, now) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return (a.checkinAt ?? Infinity) - (b.checkinAt ?? Infinity);
    });

  return {
    tasks: all,
    focusId: currentFocus,
    switchCountToday: switchTimestamps.filter((ts) => ts >= startOfDay).length,
    incoming,
    rest: activeRest
  };
}

export interface StartTaskInput {
  entity: string;
  intent: string;
  outcome?: string;
  estimateMin: number;
}

export type FocusClient = {
  listEvents(): Promise<FocusEvent[]>;
  startTask(input: StartTaskInput): Promise<string>;
  focusOn(taskId: string): Promise<void>;
  park(taskId: string, dueAt?: number): Promise<void>;
  addNote(taskId: string, text: string): Promise<void>;
  setCheckin(taskId: string, dueAt: number): Promise<void>;
  dispatchAgent(taskId: string, adapter: string, cwd: string): Promise<void>;
  done(taskId: string, note?: string, actualUnknown?: boolean): Promise<void>;
  drop(taskId: string, note?: string): Promise<void>;
  startRest(durationMin: number): Promise<void>;
  endRest(): Promise<void>;
  agentStatuses(tasks: Task[]): Promise<Record<string, AgentStatus>>;
};

/** Browser client backed by the local focus HTTP API. */
export function createFocusApiClient(basePath = "/api/focus"): FocusClient {
  /** POSTs a JSON body to a focus API path and returns the parsed response. */
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${basePath}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Focus API error (${response.status}).`);
    return response.status === 204 ? null : await response.json();
  };
  /** Appends one or more events to the log. */
  const append = (events: FocusEvent[]) => post("/events", { events });
  /** Generates a fresh task id. */
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `t_${Date.now()}_${Math.round(Math.random() * 1e9)}`);

  return {
    /** Returns the full event log; empty on error. */
    async listEvents() {
      const response = await fetch(`${basePath}/events`);
      if (!response.ok) return [];
      const value = await response.json() as unknown;
      return Array.isArray(value) ? (value as FocusEvent[]) : [];
    },
    /** Starts a task and focuses it; returns the new task id. */
    async startTask(input) {
      const ts = Date.now();
      const taskId = newId();
      await append([
        { type: "task_started", ts, taskId, entity: input.entity, intent: input.intent, outcome: input.outcome, estimateMin: input.estimateMin },
        { type: "focus_on", ts: ts + 1, taskId }
      ]);
      return taskId;
    },
    /** Makes an existing task the current focus. */
    async focusOn(taskId) {
      await append([{ type: "focus_on", ts: Date.now(), taskId }]);
    },
    /** Parks the task (leaves focus), optionally with a return-time check-in. */
    async park(taskId, dueAt) {
      const ts = Date.now();
      const events: FocusEvent[] = [{ type: "focus_off", ts, taskId }];
      if (dueAt != null) events.push({ type: "checkin_set", ts: ts + 1, taskId, dueAt });
      await append(events);
    },
    /** Appends a free-text note to a task. */
    async addNote(taskId, text) {
      await append([{ type: "note_added", ts: Date.now(), taskId, text }]);
    },
    /** Sets when a task should return to attention. */
    async setCheckin(taskId, dueAt) {
      await append([{ type: "checkin_set", ts: Date.now(), taskId, dueAt }]);
    },
    /** Dispatches an agent for the task (server opens it and records the transcript dir). */
    async dispatchAgent(taskId, adapter, cwd) {
      await post("/dispatch", { taskId, adapter, cwd });
    },
    /** Marks a task done; actualUnknown records no actual time when the finish time is unknown. */
    async done(taskId, note, actualUnknown) {
      await append([{ type: "task_done", ts: Date.now(), taskId, note, actualUnknown }]);
    },
    /** Drops a task as incomplete. */
    async drop(taskId, note) {
      await append([{ type: "task_dropped", ts: Date.now(), taskId, note }]);
    },
    /** Starts a break for the given number of minutes. */
    async startRest(durationMin) {
      await append([{ type: "rest_started", ts: Date.now(), durationMin }]);
    },
    /** Ends the active break. */
    async endRest() {
      await append([{ type: "rest_ended", ts: Date.now() }]);
    },
    /** Fetches current agent statuses for the given watched tasks. */
    async agentStatuses(tasks) {
      const dirs = tasks.filter((t) => t.agent?.transcriptDir).map((t) => ({ id: t.id, dir: t.agent!.transcriptDir! }));
      if (!dirs.length) return {};
      try {
        const value = await post("/agent-status", { dirs }) as Record<string, AgentStatus>;
        return value || {};
      } catch {
        return {};
      }
    }
  };
}
