const VIEW_ACTIONS = new Set(["camera", "focus", "fold", "loading", "facts"]);

/** Clones command values without losing Map ownership groups. */
const clone = (value) => structuredClone(value);

/** Creates source-space undo, redo, and ordered save history for one world. */
export function createAreaMapWorldHistory({ apply = () => {}, save = async () => {} } = {}) {
  const state = { undo: [], redo: [], open: null, queue: [], active: null, scheduled: false };

  /** Starts the next ordered save after callers can still cancel a fresh command. */
  function schedule() {
    if (state.scheduled || state.active || !state.queue.length) return;
    state.scheduled = true;
    queueMicrotask(async () => {
      state.scheduled = false;
      if (state.active || !state.queue.length) return;
      const item = state.queue.shift();
      state.active = item;
      try { await save(clone(item.command), item.direction); item.state = "done"; }
      finally { state.active = null; schedule(); }
    });
  }

  /** Adds one command result to the ordered save queue. */
  function enqueue(command, direction = "after") {
    const item = { command, direction, state: "queued" };
    state.queue.push(item); schedule(); return item;
  }

  /** Opens one gesture boundary. */
  function begin(kind, before, selectionBefore = []) {
    if (VIEW_ACTIONS.has(kind)) return null;
    if (state.open) throw new Error(`world command ${state.open.kind} is already open`);
    state.open = { id: crypto.randomUUID(), kind, before: clone(before), after: clone(before), selectionBefore: clone(selectionBefore), selectionAfter: clone(selectionBefore) };
    return state.open.id;
  }

  /** Replaces the latest state inside the current gesture boundary. */
  function update(after, selectionAfter = state.open?.selectionAfter ?? []) {
    if (!state.open) return false;
    state.open.after = clone(after); state.open.selectionAfter = clone(selectionAfter); return true;
  }

  /** Closes the current boundary as one undoable command. */
  function finish(after = state.open?.after, selectionAfter = state.open?.selectionAfter ?? []) {
    if (!state.open) return null;
    update(after, selectionAfter);
    const command = state.open; state.open = null;
    if (JSON.stringify([...command.before]) === JSON.stringify([...command.after])) return null;
    state.undo.push(command); state.redo.length = 0; enqueue(command, "after"); return command;
  }

  /** Records one already-bounded paste, duplicate, delete, nudge, or style action. */
  function record(kind, before, after, selectionBefore = [], selectionAfter = []) {
    if (VIEW_ACTIONS.has(kind)) return null;
    begin(kind, before, selectionBefore); return finish(after, selectionAfter);
  }

  /** Applies and queues the inverse of the latest command. */
  function undo() {
    const command = state.undo.pop(); if (!command) return false;
    state.redo.push(command); apply(clone(command.before), clone(command.selectionBefore));
    const queued = state.queue.findIndex((item) => item.command.id === command.id && item.direction === "after");
    if (queued >= 0) state.queue.splice(queued, 1);
    else enqueue(command, "before");
    return true;
  }

  /** Reapplies and queues the latest undone command. */
  function redo() {
    const command = state.redo.pop(); if (!command) return false;
    state.undo.push(command); apply(clone(command.after), clone(command.selectionAfter)); enqueue(command, "after"); return true;
  }

  /** Waits until every ordered save completes. */
  async function flush() {
    while (state.scheduled || state.active || state.queue.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { begin, update, finish, record, undo, redo, flush, state };
}

export default { createAreaMapWorldHistory };
