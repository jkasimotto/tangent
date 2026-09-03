/** True when one bounded Work row belongs to an exact Area. */
function inArea(row, areaId) {
  return !areaId || row?.areaId === areaId;
}

/** Returns only consequences that require a user-visible recovery decision. */
export function workProblemRows(work, areaId = "") {
  const brains = (work?.brains ?? []).filter((row) => inArea(row, areaId)
    && (["failed", "unknown"].includes(row.workState) || row.status === "active" && row.workState === "stopped"));
  const agents = (work?.agents ?? []).filter((row) => inArea(row, areaId) && row.liveness === "unknown");
  const processes = (work?.processes ?? []).filter((row) => inArea(row, areaId) && ["broken", "could-not-start", "did-not-start"].includes(row.state));
  const goals = (work?.goals ?? []).filter((row) => inArea(row, areaId) && ["broken", "cycle"].includes(row.blockers?.state));
  const areas = [...(work?.areas ?? [])].map((row) => row.id).filter(Boolean).sort((left, right) => right.length - left.length);
  /** Resolves one bounded sample to its responsible Area without guessing from display text. */
  const sampleArea = (sample) => {
    const direct = areas.find((candidate) => sample === candidate || String(sample).startsWith(`${candidate}/`));
    if (direct) return direct;
    return work?.agents?.find((row) => row.id === sample)?.areaId
      ?? work?.processes?.find((row) => row.id === sample)?.areaId
      ?? work?.goals?.find((row) => row.id === sample || String(sample).startsWith(`${row.id}#`))?.areaId
      ?? "";
  };
  /** True when one bounded diagnostic already has an exact consequence row. */
  const represented = (problem, sample) => problem.code === "brain-agent-missing"
    ? brains.some((row) => row.areaId === sample)
    : ["agent-observation-failed", "agent-pane-failed"].includes(problem.code)
      ? agents.some((row) => row.id === sample)
      : problem.code === "process-goal-missing"
        ? processes.some((row) => row.id === sample)
        : false;
  const diagnostics = (work?.problems ?? []).map((problem) => {
    const sampleIds = [...new Set(problem.sampleIds ?? [])];
    const representedCount = sampleIds.filter((sample) => represented(problem, sample)).length;
    const count = Math.max(0, Number(problem.count ?? 0) - representedCount);
    const sampleAreas = [...new Set(sampleIds.map(sampleArea).filter(Boolean))];
    return { ...problem, count, areaId: sampleAreas.length === 1 ? sampleAreas[0] : "" };
  }).filter((problem) => problem.count > 0 && inArea(problem, areaId));
  return { brains, agents, processes, goals, diagnostics };
}

/** Counts concrete rows and every bounded occurrence behind diagnostic rows. */
export function workProblemCount(rows) {
  return rows.brains.length + rows.agents.length + rows.processes.length + rows.goals.length
    + rows.diagnostics.reduce((count, row) => count + row.count, 0);
}

/** Counts quiet global attention from the same consequences its lenses render. */
export function workAttention(work, areaId = "") {
  const forYou = (work?.brains ?? []).filter((row) => inArea(row, areaId)).reduce((count, row) => count + Number(row.attentionCount ?? 0), 0)
    + (work?.goals ?? []).filter((row) => inArea(row, areaId) && row.workState?.owner === "user").length;
  const rows = workProblemRows(work, areaId);
  return { forYou, problems: workProblemCount(rows) };
}

/** Returns every exact Area with at least one actionable problem. */
export function workProblemAreas(work) {
  const rows = workProblemRows(work);
  return new Set(Object.values(rows).flat().map((row) => row.areaId).filter(Boolean));
}

/** True only when an open Goal is currently ready to start. */
export function areaHasReadyWork(work, areaId) {
  return (work?.goals ?? []).some((goal) => goal.areaId === areaId
    && goal.lifecycle === "open"
    && goal.blockers?.state === "ready"
    && goal.workState?.owner === "none"
    && ["open", "ready", "assignment-pending"].includes(goal.workState?.code));
}

export default { workAttention, workProblemRows, workProblemCount, workProblemAreas, areaHasReadyWork };
