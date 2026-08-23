/** Adapts a pipeline step to the shared worker-execution interface. */
export function pipelineExecution({ record, step, save }) {
  return execution({
    kind: "step",
    area: record.area,
    subject: "step",
    record,
    unit: step,
    save,
  });
}

/** Adapts a solo Goal continuation record to the worker-execution interface. */
export function soloExecution({ record, area, save }) {
  return execution({
    kind: "goal",
    area,
    subject: "Goal",
    record,
    unit: record,
    save,
  });
}

/** Creates the common mutable view over either stored execution shape. */
function execution({ kind, area, subject, record, unit, save }) {
  /** Returns the reminder timestamps stored for one session. */
  function reminder(session) {
    return unit.contextReminders?.[session];
  }

  /** Stores reminder timestamps for one session and persists the record. */
  async function saveReminder(session, value) {
    unit.contextReminders = { ...(unit.contextReminders ?? {}), [session]: value };
    await save(record);
  }

  /** Appends one context continuation and points execution at its replacement. */
  async function continueTo(entry) {
    unit.continuations = unit.continuations ?? [];
    unit.continuations.push(entry);
    unit.session = entry.next;
    await save(record);
    return entry;
  }

  /** Marks a failed continuation and restores its original session. */
  async function failContinuation(entry) {
    entry.failed = true;
    unit.session = entry.session;
    await save(record);
  }

  return {
    area,
    kind,
    record,
    subject,
    unit,
    continueTo,
    failContinuation,
    reminder,
    saveReminder,
  };
}
