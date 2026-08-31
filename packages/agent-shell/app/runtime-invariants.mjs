const MUTABLE_JOB = new Set(["open", "paused"]);
const TERMINAL_GOAL = new Set(["done", "dropped", "parked"]);

/** Returns body-free operator Problems across the four runtime authorities. */
export function runtimeInvariantProblems({ jobs = [], goals = [], brains = [], agents = [], now = Date.now() } = {}) {
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
  return problems;
}
