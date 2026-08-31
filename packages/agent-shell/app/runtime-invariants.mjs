const MUTABLE_JOB = new Set(["open", "paused"]);
const TERMINAL_GOAL = new Set(["done", "dropped", "parked"]);
const NONTERMINAL_PROCESS_ATTEMPT = new Set(["prepared", "delivery-pending", "delivered", "accepted", "goal-created", "job-created"]);

/** Returns body-free operator Problems across runtime authorities. */
export function runtimeInvariantProblems({ jobs = [], goals = [], brains = [], agents = [], processes = [], now = Date.now() } = {}) {
  const problems = [];
  const live = new Set(agents.filter((agent) => agent.live !== false).map((agent) => agent.name ?? agent.session));
  const goalByFile = new Map(goals.map((goal) => [goal.file, goal]));
  for (const job of jobs) {
    const mutable = (job.runs ?? []).filter((run) => MUTABLE_JOB.has(run.status) && !run.sealedAt);
    if (mutable.length > 1) problems.push({ code: "multiple-mutable-job-runs", address: job.goal, runs: mutable.map((run) => run.run) });
    const current = (job.runs ?? []).find((run) => run.run === job.currentRun);
    const attempt = current?.assignments?.flatMap((assignment) => assignment.attempts ?? []).find((item) => !item.endedAt);
    if (attempt && TERMINAL_GOAL.has(goalByFile.get(job.goal)?.status)) problems.push({ code: "attempt-on-terminal-goal", address: job.goal, run: current.run, attemptId: attempt.id });
  }
  for (const goal of goals) {
    if (!goal.session) continue;
    const job = jobs.find((item) => item.goal === goal.file);
    const current = job?.runs?.find((run) => run.run === job.currentRun);
    const bound = current?.assignments?.some((assignment) => assignment.attempts?.some((attempt) => attempt.session === goal.session && !attempt.endedAt));
    if (!bound) problems.push({ code: "binding-without-current-attempt", address: goal.file, session: goal.session });
  }
  for (const brain of brains) {
    const authoritative = (brain.generations ?? []).filter((generation) => generation.state === "active");
    if (authoritative.length > 1) problems.push({ code: "multiple-authoritative-generations", address: brain.area, generations: authoritative.map((generation) => generation.generation) });
    const succession = brain.succession;
    if (succession && !["complete", "failed", "promoted", "retiring"].includes(succession.status) && Date.parse(succession.deadlineAt) <= now) problems.push({ code: "staged-successor-deadline", address: brain.area, operationId: succession.id });
    if (succession && ["promoted", "retiring"].includes(succession.status) && live.has(succession.source?.session)) problems.push({ code: "promoted-outgoing-live", address: brain.area, operationId: succession.id, session: succession.source.session });
  }
  const processByFile = new Map(processes.map((process) => [process.file, process]));
  const processRuns = new Map();
  for (const job of jobs) {
    for (const run of job.runs ?? []) {
      if (run.origin?.kind !== "process") continue;
      const key = `${run.origin.processFile}\0${run.origin.eventId}`;
      const refs = processRuns.get(key) ?? [];
      refs.push({ goal: job.goal, run: run.run, origin: run.origin });
      processRuns.set(key, refs);
    }
  }
  for (const [key, refs] of processRuns) {
    const goalsForEvent = [...new Set(refs.map((ref) => ref.goal))];
    if (goalsForEvent.length > 1) {
      const [processFile, eventId] = key.split("\0");
      problems.push({ code: "process-event-multiple-goals", address: processFile, area: processByFile.get(processFile)?.area ?? null, eventId, goals: goalsForEvent });
    }
  }
  for (const process of processes) {
    const event = process.state?.currentEvent;
    if (!event) continue;
    const attempts = event.attempts ?? [];
    const nonterminal = attempts.filter((attempt) => NONTERMINAL_PROCESS_ATTEMPT.has(attempt.status));
    if (nonterminal.length > 1) problems.push({ code: "process-multiple-nonterminal-attempts", address: process.file, area: process.area, eventId: event.id, attemptIds: nonterminal.map((attempt) => attempt.id) });
    for (const attempt of nonterminal) {
      if (Date.parse(attempt.deadlineAt) <= now) problems.push({ code: "process-start-deadline-passed", address: process.file, area: process.area, eventId: event.id, attemptId: attempt.id, deadlineAt: attempt.deadlineAt });
    }
    const disabledAt = Date.parse(process.state?.auto?.disabledAt);
    const afterBreaker = attempts.find((attempt) => attempt.trigger === "auto" && attempt.status === "started" && Number.isFinite(disabledAt) && Date.parse(attempt.requestedAt) >= disabledAt);
    if (afterBreaker) problems.push({ code: "process-auto-start-after-breaker", address: process.file, area: process.area, eventId: event.id, attemptId: afterBreaker.id, disabledAt: process.state.auto.disabledAt });
    if (!event.goalFile || !event.job?.run) {
      if (event.status === "running") problems.push({ code: "process-running-without-job", address: process.file, area: process.area, eventId: event.id, goal: event.goalFile ?? null, run: event.job?.run ?? null });
      continue;
    }
    const job = jobs.find((item) => item.goal === event.goalFile);
    const run = job?.runs?.find((item) => item.run === event.job.run);
    if (event.status === "running" && !run) problems.push({ code: "process-running-without-job", address: process.file, area: process.area, eventId: event.id, goal: event.goalFile, run: event.job.run });
    if (run && (run.origin?.kind !== "process" || run.origin.processFile !== process.file || run.origin.eventId !== event.id)) {
      problems.push({ code: "process-job-origin-mismatch", address: process.file, area: process.area, eventId: event.id, goal: event.goalFile, run: event.job.run });
    }
  }
  return problems;
}
