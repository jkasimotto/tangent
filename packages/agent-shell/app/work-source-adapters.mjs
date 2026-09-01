import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { readAllJobs, jobRun } from "./job-record.mjs";
import { readAllBrains, currentGeneration } from "./brain-record.mjs";
import { openBrainRequests, readBrainRequests } from "./brain-requests.mjs";
import { discoverProcesses, processView, readProcessState } from "./process-scheduler.mjs";
import { projectCards, projectPresentations, readGoalPresentations } from "./goal-presentations.mjs";
import { projectAreaPresentations, readAreaPresentations } from "./area-presentations.mjs";
import { deriveWorkRowState, projectWorkAssignment, selectWorkAssignment, workAgentActivity } from "./work-row-state.mjs";
import { WORK_DOMAINS, WORK_LIMITS, WORK_SCHEMA, workHash, workText } from "./work-model.mjs";

const SKIP_DIRECTORIES = new Set([".git", ".obsidian", "shared", "node_modules"]);
const FINAL_ASSIGNMENTS = new Set(["complete", "ended", "skipped"]);
const SETTLED_GOALS = new Set(["done", "dropped"]);

/** Creates the seven retaining source adapters that feed the Work publisher. */
export function createWorkSourceAdapters({ treesRoot, jobsRoot, brainsRoot, processesRoot, presentationsRoot, loadAgents, now = () => new Date(), metric = () => {} }) {
  const adapters = {
    areas: retainingAdapter("areas", () => enumerateAreas(treesRoot), { metric }),
    goals: retainingAdapter("goals", () => enumerateGoals(treesRoot), { metric }),
    jobs: retainingAdapter("jobs", () => enumerateJobs(jobsRoot), { metric }),
    agents: retainingAdapter("agents", loadAgents, { onFailure: unknownAgents, metric }),
    brains: retainingAdapter("brains", () => enumerateBrains(brainsRoot), { metric }),
    processes: retainingAdapter("processes", () => enumerateProcessSources(treesRoot, processesRoot, now()), { metric }),
    presentations: retainingAdapter("presentations", () => enumeratePresentations({ presentationsRoot, areas: adapters.areas.rows(), goals: adapters.goals.rows() }), { metric }),
  };

  /** Reconciles all exact source classes, then creates one bounded candidate. */
  async function reconcile(domains = WORK_DOMAINS) {
    const requested = new Set(domains);
    for (const domain of WORK_DOMAINS) {
      if (!requested.has(domain) && adapters[domain].ready()) continue;
      await adapters[domain].reconcile();
    }
    // Presentation owners are Area and Goal identities. Refresh them after
    // either owner collection changes, even when the invalidation was narrow.
    if ((requested.has("areas") || requested.has("goals")) && !requested.has("presentations")) await adapters.presentations.reconcile();
    return buildWorkCandidate(Object.fromEntries(WORK_DOMAINS.map((domain) => [domain, adapters[domain].snapshot()])));
  }

  return { adapters, reconcile,
    /** Builds a candidate from the retained source maps. */
    snapshot: () => buildWorkCandidate(Object.fromEntries(WORK_DOMAINS.map((domain) => [domain, adapters[domain].snapshot()]))),
  };
}

/** Retains the last complete map when enumeration fails. */
export function retainingAdapter(domain, load, { onFailure = (rows) => rows, metric = () => {} } = {}) {
  let rows = new Map();
  let condition = "degraded";
  let version = workHash([]);
  let problems = [{ code: "source-enumeration-failed", source: domain, count: 1, sampleIds: [] }];
  let initialized = false;

  /** Replaces one retained map only after a complete read. */
  async function reconcile() {
    const startedAt = performance.now();
    try {
      const result = normalizeLoadResult(await load());
      const next = new Map(result.rows.map((row) => [row.id, row]));
      for (const id of result.invalidIds) if (rows.has(id)) next.set(id, rows.get(id));
      rows = next;
      condition = result.invalidIds.length || result.problems.length ? "degraded" : "current";
      problems = summarizeProblems(domain, [
        ...result.problems,
        ...(result.invalidIds.length ? [{ code: "source-record-invalid", ids: result.invalidIds }] : []),
      ]);
      version = workHash([...rows.values()].sort(byId));
      initialized = true;
      metric("work_source_read_ms", performance.now() - startedAt, { domain });
      for (const item of problems) metric("work_source_error_total", item.count, { domain, code: item.code });
      return { ok: true, condition, version };
    } catch (error) {
      rows = new Map([...onFailure([...rows.values()], error)].map((row) => [row.id, row]));
      condition = "degraded";
      problems = [{ code: domain === "agents" ? "agent-observation-failed" : "source-enumeration-failed", source: domain, count: 1, sampleIds: [] }];
      version = workHash([...rows.values()].sort(byId));
      initialized = true;
      metric("work_source_read_ms", performance.now() - startedAt, { domain });
      metric("work_source_error_total", 1, { domain, code: problems[0].code });
      return { ok: false, condition, version, error };
    }
  }

  return {
    reconcile,
    /** Returns whether this adapter completed at least one read. */
    ready: () => initialized,
    /** Returns the retained normalized rows. */
    rows: () => [...rows.values()],
    /** Returns rows with their source fence and bounded problems. */
    snapshot: () => ({ rows: [...rows.values()], condition, version, problems }),
  };
}

/** Builds the complete candidate from normalized source snapshots. */
export function buildWorkCandidate(sources) {
  /** Returns normalized rows for one source domain. */
  const sourceRows = (domain) => sources[domain]?.rows ?? [];
  const areaSources = sourceRows("areas");
  const goalSources = sourceRows("goals");
  const jobs = sourceRows("jobs");
  let agents = [...sourceRows("agents")];
  const allBrainSources = sourceRows("brains");
  const processes = sourceRows("processes");
  const presented = new Map(sourceRows("presentations").map((row) => [row.id, row]));
  const sourceAreaIds = new Set(areaSources.map((row) => row.id));
  const brainSources = allBrainSources.filter((row) => sourceAreaIds.has(row.areaId));
  const orphanBrains = allBrainSources.filter((row) => !sourceAreaIds.has(row.areaId));
  const sourceGoalIds = new Set(goalSources.map((row) => row.id));
  const sourceGoalArea = new Map(goalSources.map((row) => [row.id, row.areaId]));
  const sourceBrainAreas = new Set(brainSources.map((row) => row.areaId));
  const invalidOwners = [];
  agents = agents.map((agent) => {
    const ownerValid = agent.owner.kind === "assignment" ? sourceGoalIds.has(agent.owner.goalId)
      : ["brain", "repair"].includes(agent.owner.kind) ? sourceBrainAreas.has(agent.owner.id) : true;
    const areaId = agent.areaId && sourceAreaIds.has(agent.areaId) ? agent.areaId : null;
    if (ownerValid && areaId === agent.areaId) return agent;
    invalidOwners.push(agent.id);
    return { ...agent, areaId, owner: { kind: "unresolved", id: agent.id }, evidence: "The Agent owner does not resolve to a current durable source." };
  });
  const observedAgentIds = new Set(agents.map((row) => row.id));
  const liveAgentIds = new Set(agents.filter((row) => row.liveness === "live").map((row) => row.id));
  const selectedJobs = jobs.map((job) => {
    const assignment = projectWorkAssignment(selectWorkAssignment(job.assignmentCandidates ?? [], liveAgentIds), job.counts.total);
    const { assignmentCandidates: _assignmentCandidates, ...record } = job;
    return { ...record, assignment };
  });
  const knownAgentIds = new Set(observedAgentIds);
  for (const job of selectedJobs) {
    const agentId = job.assignment?.agentId;
    if (!agentId || knownAgentIds.has(agentId) || !sourceGoalIds.has(job.goalId)) continue;
    agents.push(absentAgent(agentId, { kind: "assignment", goalId: job.goalId, run: job.run, assignmentId: job.assignment.id }, sourceGoalArea.get(job.goalId) ?? null));
    knownAgentIds.add(agentId);
  }
  for (const brain of brainSources) {
    if (!brain.agentId || knownAgentIds.has(brain.agentId)) continue;
    agents.push(absentAgent(brain.agentId, { kind: "brain", id: brain.areaId }, brain.areaId, "brain"));
    knownAgentIds.add(brain.agentId);
  }
  const agentByAssignment = new Map();
  for (const agent of agents) if (agent.owner.kind === "assignment") agentByAssignment.set(`${agent.owner.goalId}\0${agent.owner.run}\0${agent.owner.assignmentId}`, agent);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const brains = brainSources.map(({ id: _id, ...brain }) => {
    const agent = brain.agentId ? agentsById.get(brain.agentId) ?? null : null;
    return { ...brain, workState: brainWorkState(brain, agent) };
  });
  const brainByArea = new Map(brains.map((brain) => [brain.areaId, brain]));
  const jobByGoal = new Map(selectedJobs.map((job) => [job.goalId, job]));

  const visibleGoalIds = new Set(goalSources.filter((goal) => ["open", "verify"].includes(goal.lifecycle)).map((goal) => goal.id));
  for (const job of selectedJobs) if (!["complete", "parked", "stopped"].includes(job.state)) visibleGoalIds.add(job.goalId);
  for (const agent of agents) if (agent.owner.kind === "assignment") visibleGoalIds.add(agent.owner.goalId);
  const goalsById = new Map(goalSources.map((goal) => [goal.id, goal]));
  for (const id of [...visibleGoalIds]) {
    let parent = goalsById.get(id)?.parentGoalId;
    while (parent && goalsById.has(parent)) { visibleGoalIds.add(parent); parent = goalsById.get(parent).parentGoalId; }
  }

  const goalAreaIds = new Set([...visibleGoalIds].map((id) => goalsById.get(id)?.areaId).filter(Boolean));
  const processAreaIds = new Set(processes.map((row) => row.areaId));
  const brainAreaIds = new Set(brains.map((row) => row.areaId));
  const includedAreaIds = new Set(areaSources.filter((area) => area.state === "open").map((area) => area.id));
  for (const id of [...goalAreaIds, ...processAreaIds, ...brainAreaIds]) includedAreaIds.add(id);
  const areasById = new Map(areaSources.map((area) => [area.id, area]));
  for (const id of [...includedAreaIds]) {
    let parent = areasById.get(id)?.parentId;
    while (parent && areasById.has(parent)) { includedAreaIds.add(parent); parent = areasById.get(parent).parentId; }
  }

  const areas = areaSources.filter((area) => includedAreaIds.has(area.id)).map((area) => {
    const owner = presented.get(`area:${area.id}`) ?? { items: [], more: 0 };
    return { ...area, visibility: area.state === "open" ? "work" : "ancestor", presented: owner.items, morePresentedCount: owner.more };
  }).sort(byId);

  const goals = goalSources.filter((goal) => visibleGoalIds.has(goal.id)).map((goal) => {
    const job = jobByGoal.get(goal.id) ?? null;
    const selected = job?.assignment ?? null;
    const agent = selected ? agentByAssignment.get(`${goal.id}\0${job.run}\0${selected.id}`) ?? agents.find((row) => row.id === selected.agentId) ?? null : null;
    const brain = brainByArea.get(goal.areaId) ?? null;
    const owner = presented.get(`goal:${goal.id}`) ?? { items: [], more: 0 };
    const required = ["goals", ...(job ? ["jobs"] : []), ...(agent ? ["agents"] : [])];
    const sourcesCurrent = required.every((domain) => sources[domain]?.condition === "current");
    return {
      ...goal,
      startedAt: goal.startedAt ?? job?.startedAt ?? null,
      visibility: ["open", "verify"].includes(goal.lifecycle) ? "work" : job || agent ? "runtime-context" : "ancestor",
      workState: deriveWorkRowState({ goal, execution: job, assignment: selected, agent, brain, sourcesCurrent }),
      execution: job ? withoutJobOwner(job) : null,
      presented: owner.items,
      morePresentedCount: owner.more,
    };
  }).sort((left, right) => left.rank - right.rank || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

  const knownGoalIds = new Set(goalsById.keys());
  const problems = [...WORK_DOMAINS.flatMap((domain) => sources[domain]?.problems ?? [])];
  if (orphanBrains.length) problems.push(problem("source-record-invalid", "brains", orphanBrains.map((row) => row.areaId)));
  if (invalidOwners.length) problems.push(problem("agent-owner-unresolved", "model", invalidOwners));
  const missingJobs = selectedJobs.filter((job) => !knownGoalIds.has(job.goalId) && !["complete", "parked", "stopped"].includes(job.state));
  if (missingJobs.length) problems.push(problem("job-goal-missing", "jobs", missingJobs.map((row) => row.id)));
  const missingBrains = brains.filter((brain) => brain.agentId && !observedAgentIds.has(brain.agentId));
  if (missingBrains.length) problems.push(problem("brain-agent-missing", "brains", missingBrains.map((row) => row.areaId)));
  const missingProcesses = processes.filter((row) => row.goalId && !knownGoalIds.has(row.goalId));
  if (missingProcesses.length) problems.push(problem("process-goal-missing", "processes", missingProcesses.map((row) => row.id)));

  return {
    schema: WORK_SCHEMA,
    fence: Object.fromEntries(WORK_DOMAINS.map((domain) => [domain, { version: sources[domain]?.version ?? workHash([]), condition: sources[domain]?.condition ?? "degraded" }])),
    areas,
    goals,
    agents: [...agents].sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) || left.id.localeCompare(right.id)),
    brains: [...brains].sort((left, right) => left.areaId.localeCompare(right.areaId)),
    processes: processes.map((row) => withoutProcessGoal({ ...row, brainLive: brainByArea.get(row.areaId)?.workState === "working" || brainByArea.get(row.areaId)?.workState === "waiting" })).sort((left, right) => left.areaId.localeCompare(right.areaId) || left.id.localeCompare(right.id)),
    problems: combineProblems(problems),
  };
}

/** Derives bounded Brain state from durable and observed facts. */
function brainWorkState(brain, agent) {
  if (brain.status === "failed") return "failed";
  if (brain.status !== "active") return "stopped";
  if (!agent || agent.liveness === "unknown") return "unknown";
  if (agent.liveness === "absent") return "stopped";
  if (agent.activity === "waiting") return "waiting";
  if (agent.activity === "working") return "working";
  return agent.activity === "shell" ? "stopped" : "unknown";
}

/** Reads direct visible Area directories and notes. */
async function enumerateAreas(treesRoot) {
  const directories = await walkAreaDirectories(treesRoot);
  const rows = [];
  const invalidIds = [];
  for (const area of directories) {
    const note = path.join(treesRoot, area, `${path.basename(area)}.md`);
    try {
      const text = await readFile(note, "utf8");
      const fields = frontmatter(text);
      rows.push({ id: area, parentId: parentArea(area), label: workText(markdownTitle(text, path.basename(area)), WORK_LIMITS.label), state: areaState(fields.status) });
    } catch (error) {
      if (error.code === "ENOENT") rows.push({ id: area, parentId: parentArea(area), label: workText(path.basename(area), WORK_LIMITS.label), state: "open" });
      else invalidIds.push(area);
    }
  }
  return { rows, invalidIds };
}

/** Reads direct Goal notes without a vault-wide projection. */
async function enumerateGoals(treesRoot) {
  const areas = await walkAreaDirectories(treesRoot);
  const raw = [];
  const invalidIds = [];
  for (const area of areas) {
    const directory = path.join(treesRoot, area);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^(?:goal|outcome)-[a-z0-9-]+\.md$/.test(entry.name)) continue;
      const id = `${area}/${entry.name}`;
      try {
        const text = await readFile(path.join(directory, entry.name), "utf8");
        const fields = frontmatter(text);
        if (!["goal", "outcome"].includes(fields.type)) { invalidIds.push(id); continue; }
        raw.push({
          id,
          areaId: area,
          slug: entry.name.replace(/^(?:goal|outcome)-/, "").replace(/\.md$/, ""),
          title: workText(markdownTitle(text, entry.name.replace(/\.md$/, "")), WORK_LIMITS.title),
          lifecycle: goalLifecycle(fields.status),
          verify: /^(?:yes|true)$/i.test(fields.verify ?? ""),
          blockers: blockersOf(fields.waiting_on),
          subgoals: goalLinks(section(text, "Subgoals") || section(text, "Breakdown")),
        });
      } catch { invalidIds.push(id); }
    }
  }
  const bySlug = new Map();
  for (const goal of raw) {
    if (!bySlug.has(goal.slug)) bySlug.set(goal.slug, goal.id);
    else bySlug.set(goal.slug, null);
  }
  const parentById = new Map();
  for (const goal of raw) for (const slug of goal.subgoals) {
    const child = bySlug.get(slug);
    if (child && !parentById.has(child)) parentById.set(child, goal.id);
  }
  let rank = 0;
  const ordered = [];
  /** Appends one Goal and its declared children to rank order. */
  const visit = (goal) => {
    if (ordered.includes(goal.id)) return;
    ordered.push(goal.id);
    for (const slug of goal.subgoals) {
      const id = bySlug.get(slug);
      const child = raw.find((row) => row.id === id);
      if (child) visit(child);
    }
  };
  for (const goal of raw.filter((row) => !parentById.has(row.id)).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) visit(goal);
  for (const goal of raw.sort((a, b) => a.id.localeCompare(b.id))) visit(goal);
  const rankById = new Map(ordered.map((id) => [id, rank++]));
  return { rows: raw.map(({ slug: _slug, subgoals: _subgoals, ...goal }) => ({ ...goal, parentGoalId: parentById.get(goal.id) ?? null, rank: rankById.get(goal.id), startedAt: null })), invalidIds };
}

/** Reads only each canonical Job's current run. */
async function enumerateJobs(root) {
  const rows = [];
  const invalidIds = [];
  for (const file of await readAllJobs(root)) {
    const run = jobRun(file);
    if (!run) continue;
    const goalId = file.goal;
    if (typeof goalId !== "string" || !goalId) { invalidIds.push(`job-run-${Math.max(1, Number(run.run) || 1)}`); continue; }
    const assignments = run.assignments ?? run.steps ?? [];
    const assignmentCandidates = assignments.map((assignment) => {
      const projected = projectWorkAssignment(assignment, assignments.length);
      return {
        id: projected.id, index: projected.index, kind: projected.kind, status: projected.state,
        label: projected.label, instruction: projected.instructionPreview, launch: projected.launchRef,
        session: projected.agentId, startedAt: projected.startedAt, endedAt: projected.endedAt,
      };
    });
    rows.push({
      id: `${goalId}#${run.run}`,
      goalId,
      run: Math.max(1, Number(run.run) || 1),
      revision: Math.max(0, Number(run.revision ?? file.fileRevision) || 0),
      state: jobState(run.status),
      assignmentCandidates,
      counts: { total: assignments.length, final: assignments.filter((row) => FINAL_ASSIGNMENTS.has(row.status)).length, pending: assignments.filter((row) => row.status === "pending").length },
      startedAt: earliestTime([run.startedAt, ...assignments.map((row) => row.startedAt)]),
      endedAt: isoOrNull(run.endedAt),
    });
  }
  return { rows, invalidIds };
}

/** Reads bounded Brain state and open Request counts. */
async function enumerateBrains(root) {
  const records = await readAllBrains(root);
  const rows = [];
  for (const record of records) {
    const requests = openBrainRequests(await readBrainRequests(root, record.area));
    rows.push({
      id: record.area,
      areaId: record.area,
      status: brainStatus(record),
      generation: Math.max(0, Number(record.generation) || 0),
      attemptId: record.currentAttemptId ?? null,
      agentId: record.session ?? currentGeneration(record)?.session ?? null,
      workState: record.status === "active" ? "unknown" : "stopped",
      attentionCount: requests.length,
    });
  }
  return rows;
}

/** Reads Process notes and their current scheduler state. */
async function enumerateProcessSources(treesRoot, statesRoot, now) {
  const notes = await discoverProcesses(treesRoot);
  const rows = [];
  const invalidIds = [];
  for (const note of notes) {
    const id = note.file;
    const state = await readProcessState(statesRoot, note.area, note.slug);
    const view = processView(note, state, now);
    if (note.error) invalidIds.push(id);
    rows.push({
      id,
      areaId: note.area,
      slug: workText(note.slug, WORK_LIMITS.label),
      title: workText(note.title, WORK_LIMITS.title),
      status: note.status === "paused" ? "paused" : "active",
      state: processState(view),
      stateDetail: view.stateDetail ? workText(view.stateDetail, WORK_LIMITS.detail) : null,
      whenLabel: workText(view.when, WORK_LIMITS.label),
      loop: Boolean(note.loop),
      bodyPreview: note.loop ? workText(note.body, WORK_LIMITS.instruction) : null,
      due: Boolean(view.due),
      brainLive: Boolean(view.brainLive),
      eventId: view.eventId ? workText(view.eventId, WORK_LIMITS.identity) : null,
      revision: Math.max(0, Number(view.revision) || 0),
      missedCount: Math.max(0, Number(view.missedCount) || 0),
      missedSince: isoOrNull(view.missedSince),
      goalId: view.lastGoalFile ?? null,
    });
  }
  return { rows, invalidIds };
}

/** Reads bounded presentation summaries for current owners. */
async function enumeratePresentations({ presentationsRoot, areas, goals }) {
  const rows = [];
  for (const area of areas) {
    const items = projectAreaPresentations(await readAreaPresentations(presentationsRoot, area.id)).map(projectDocument);
    rows.push(presentedOwner(`area:${area.id}`, items));
  }
  for (const goal of goals) {
    const slug = path.basename(goal.id, ".md").replace(/^(?:goal|outcome)-/, "");
    const record = await readGoalPresentations(presentationsRoot, goal.areaId, slug);
    const items = [
      ...projectPresentations(record).map(projectDocument),
      ...projectCards(record).map(projectCard),
    ].sort((left, right) => String(right.presentedAt ?? "").localeCompare(String(left.presentedAt ?? "")));
    rows.push(presentedOwner(`goal:${goal.id}`, items));
  }
  return rows;
}

/** Normalizes a complete owned tmux observation without reading Jobs or Brains. */
export function normalizeOwnedAgents(sessions) {
  const rows = [];
  const problems = [];
  for (const session of sessions ?? []) {
    const owner = ownerOf(session);
    const role = roleOf(session);
    if (owner.kind === "unresolved") problems.push({ code: "agent-owner-unresolved", ids: [session.name] });
    const observed = workAgentActivity(session);
    rows.push({
      id: workText(session.name, WORK_LIMITS.identity),
      target: workText(session.target || session.name, WORK_LIMITS.identity),
      role,
      areaId: session.area ? workText(session.area, WORK_LIMITS.identity) : null,
      owner,
      liveness: "live",
      activity: observed.activity,
      activityDetail: observed.activityDetail,
      activitySince: isoOrNull(session.waitingSince ?? session.idleSince ?? (session.observedAt ? new Date(session.observedAt).toISOString() : null)),
      evidence: workText(agentEvidence(session), WORK_LIMITS.detail) || null,
      observedAt: session.observedAt ? new Date(session.observedAt).toISOString() : null,
      contextUsedTokens: Number.isFinite(session.context?.usedTokens) ? Math.max(0, Math.round(session.context.usedTokens)) : null,
      cwd: session.cwd ? workText(session.cwd, WORK_LIMITS.identity) : null,
      launchRef: parseLaunchRef(session.launchRef),
      createdAt: session.created ? new Date(session.created).toISOString() : null,
      workTitle: session.workTitle ? workText(session.workTitle, WORK_LIMITS.title) : null,
    });
  }
  const unique = new Map();
  for (const row of rows) {
    const existing = unique.get(row.id);
    if (!existing) { unique.set(row.id, row); continue; }
    problems.push({ code: "agent-owner-duplicate", ids: [row.id] });
    unique.set(row.id, { ...existing, owner: { kind: "unresolved", id: row.id }, evidence: "More than one owned Agent record has this identity." });
  }
  return { rows: [...unique.values()], problems };
}

/** Normalizes an adapter result envelope. */
function normalizeLoadResult(value) {
  if (Array.isArray(value)) return { rows: value, invalidIds: [], problems: [] };
  return { rows: value?.rows ?? [], invalidIds: value?.invalidIds ?? [], problems: value?.problems ?? [] };
}

/** Retains Agent identities while marking observation facts unknown. */
function unknownAgents(rows) {
  return rows.map((row) => ({ ...row, liveness: "unknown", activity: "unknown", activityDetail: "unknown", evidence: "The complete Agent observation failed." }));
}

/** Creates one explicit absent Agent referenced by durable state. */
function absentAgent(id, owner, areaId = null, role = "worker") {
  return {
    id: workText(id, WORK_LIMITS.identity), target: workText(id, WORK_LIMITS.identity), role, areaId, owner,
    liveness: "absent", activity: "unknown", activityDetail: "unknown", activitySince: null,
    evidence: "A durable source references an Agent that is absent from the complete observation.", observedAt: null,
    contextUsedTokens: null, cwd: null, launchRef: null, createdAt: null, workTitle: null,
  };
}

/** Enumerates visible Area directories and excludes runtime debris. */
async function walkAreaDirectories(root) {
  const rows = [];
  /** Walks exact visible directories and rejects symlinks. */
  async function walk(directory, relative) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const id = relative ? `${relative}/${entry.name}` : entry.name;
      rows.push(id);
      await walk(path.join(directory, entry.name), id);
    }
  }
  await walk(root, "");
  return rows.sort();
}

/** Reads the small scalar subset of note frontmatter. */
function frontmatter(text) {
  const match = String(text).match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split("\n").map((line) => line.match(/^([a-zA-Z_]+):\s*(.*)$/)).filter(Boolean).map((row) => [row[1], row[2].trim()]));
}

/** Returns one named Markdown section. */
function section(text, name) {
  const found = String(text).split(/^## /m).find((part) => part.startsWith(name));
  return found ? found.slice(name.length).replace(/^\n+/, "").split(/^## /m)[0].trim() : "";
}

/** Returns unique linked Goal slugs. */
function goalLinks(text) {
  return [...new Set([...String(text).matchAll(/\[\[(?:goal|outcome)-([a-z0-9-]+)(?:[^\]]*)\]\]/g)].map((match) => match[1]))];
}

/** Returns a note title or its stable fallback. */
function markdownTitle(text, fallback) { return String(text).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback; }
/** Returns one Area's direct parent. */
function parentArea(area) { return area.includes("/") ? area.slice(0, area.lastIndexOf("/")) : null; }
/** Normalizes Area lifecycle. */
function areaState(value) { return value === "done" ? "done" : value === "archived" ? "archived" : "open"; }
/** Normalizes legacy Goal lifecycle values. */
function goalLifecycle(value) { return value === "active" ? "open" : value === "deferred" ? "parked" : ["open", "verify", "done", "dropped", "parked"].includes(value) ? value : "open"; }
/** Counts declared Goal blockers. */
function blockersOf(value) { const count = String(value ?? "").split(/[ ,]+/).filter(Boolean).length; return { state: count ? "blocked" : "ready", count }; }
/** Normalizes canonical and legacy Job states. */
function jobState(value) { return value === "complete" ? "complete" : value === "parked" || value === "paused" ? "parked" : value === "stopped" || value === "canceled" ? "stopped" : value === "open" ? "open" : "unknown"; }
/** Normalizes durable Brain status. */
function brainStatus(record) { return record.status === "active" ? "active" : record.status === "stopping" ? "stopping" : record.status === "failed" ? "failed" : "inactive"; }
/** Normalizes the Process view state. */
function processState(view) {
  const words = String(view.state ?? "").toLowerCase();
  if (words === "loop") return "loop";
  if (words === "waiting for brain") return "waiting-for-brain";
  if (words === "running") return "running";
  if (words === "starting") return "starting";
  if (words === "did not start") return "did-not-start";
  if (words === "could not start") return "could-not-start";
  if (words === "needs you") return "needs-user";
  if (words.startsWith("deferred")) return "deferred";
  if (words === "paused") return "paused";
  if (words === "broken note") return "broken";
  return "waiting";
}

/** Derives an owned Agent relation from exact tmux tags. */
function ownerOf(session) {
  if (session.kind === "brain" && (session.brain || session.area)) return { kind: "brain", id: workText(session.brain || session.area, WORK_LIMITS.identity) };
  if (session.kind === "repair" && session.area) return { kind: "repair", id: workText(session.area, WORK_LIMITS.identity) };
  if (session.goal || session.pipeline) return {
    kind: "assignment",
    goalId: workText(session.goal || session.pipeline, WORK_LIMITS.identity),
    run: Math.max(1, Number(session.run) || 1),
    assignmentId: workText(session.assignment || `assignment-${session.step || 1}`, WORK_LIMITS.identity),
  };
  if (session.workTitle) return { kind: "definition", id: workText(session.name, WORK_LIMITS.identity) };
  if (session.kind || session.area) return { kind: "unresolved", id: workText(session.name, WORK_LIMITS.identity) };
  return { kind: "none", id: null };
}

/** Derives one bounded Agent role. */
function roleOf(session) {
  if (session.kind === "brain") return "brain";
  if (session.kind === "repair") return "repair";
  if (session.goal || session.pipeline) return "worker";
  if (session.workTitle) return "definition";
  return "unassigned";
}

/** Returns bounded evidence for observed Agent activity. */
function agentEvidence(session) {
  if (session.fresh === false) return "The latest pane observation failed.";
  if (session.state === "shell") return "The Agent session is at a shell.";
  if (session.stateDetail === "decision") return session.stateQuestion || "The Agent needs a decision.";
  if (session.stateDetail === "draft") return "The Agent holds an unsent draft.";
  if (session.stateDetail === "wall") return "The Agent stopped at a harness wall.";
  if (session.state === "waiting") return "The Agent waits for input.";
  if (session.state === "working") return "The Agent pane has current activity.";
  return "The Agent starts.";
}

/** Parses a bounded harness launch identity. */
function parseLaunchRef(value) {
  if (value && typeof value === "object" && value.harness) return { harness: workText(value.harness, WORK_LIMITS.label), model: value.model ? workText(value.model, WORK_LIMITS.label) : null, effort: value.effort ? workText(value.effort, WORK_LIMITS.label) : null };
  const [harness, model = null, effort = null] = String(value ?? "").split("/");
  return harness ? { harness: workText(harness, WORK_LIMITS.label), model: model ? workText(model, WORK_LIMITS.label) : null, effort: effort ? workText(effort, WORK_LIMITS.label) : null } : null;
}

/** Projects one document presentation summary. */
function projectDocument(item) {
  return { type: "document", id: workText(item.id, WORK_LIMITS.identity), file: workText(item.file, WORK_LIMITS.identity), root: item.root === "repository" ? "repository" : "vault", repository: item.repository ? workText(item.repository, WORK_LIMITS.identity) : null, title: workText(item.title, WORK_LIMITS.title), note: item.note ? workText(item.note, WORK_LIMITS.detail) : null, presentedBy: workText(presenterId(item.presentedBy), WORK_LIMITS.identity), presentedHash: workText(item.presentedHash, WORK_LIMITS.identity), presentedAt: item.presentedAt ?? "" };
}

/** Projects one card presentation summary. */
function projectCard(item) {
  return { type: "card", id: workText(item.id, WORK_LIMITS.identity), kind: ["copy", "link", "links", "progress", "checklist", "commits", "reviews"].includes(item.kind) ? item.kind : "progress", title: workText(item.title, WORK_LIMITS.title), summary: workText(item.summary, WORK_LIMITS.detail), presentedBy: workText(presenterId(item.presentedBy), WORK_LIMITS.identity), presenterLive: typeof item.presenterLive === "boolean" ? item.presenterLive : null, presentedAt: item.presentedAt ?? "" };
}

/** Returns one stable presenter identity. */
function presenterId(value) { return typeof value === "string" ? value : value?.session ?? value?.name ?? "unknown"; }
/** Bounds presentations for one owner. */
function presentedOwner(id, all) { const items = all.slice(0, WORK_LIMITS.presented).map(({ presentedAt: _at, ...item }) => item); return { id, items, more: Math.max(0, all.length - items.length) }; }
/** Removes Job fields already owned by the Goal row. */
function withoutJobOwner({ id: _id, goalId: _goalId, startedAt: _startedAt, endedAt: _endedAt, ...job }) { return job; }
/** Removes the internal Process-to-Goal validation field. */
function withoutProcessGoal({ goalId: _goalId, ...process }) { return process; }

/** Summarizes raw adapter problems with bounded samples. */
function summarizeProblems(source, entries) {
  return combineProblems(entries.map((entry) => problem(entry.code, source, entry.ids ?? [])));
}

/** Creates one bounded problem row. */
function problem(code, source, ids) { return { code, source, count: Math.max(1, ids.length), sampleIds: ids.slice(0, WORK_LIMITS.problemSamples).map((id) => workText(id, WORK_LIMITS.identity)) }; }

/** Combines equivalent problems without unbounded identities. */
function combineProblems(problems) {
  const grouped = new Map();
  for (const item of problems) {
    if (!item?.code || !item?.source) continue;
    const key = `${item.source}\0${item.code}`;
    const current = grouped.get(key) ?? { code: item.code, source: item.source, count: 0, sampleIds: [] };
    current.count += Math.max(0, Number(item.count) || 0);
    current.sampleIds = [...new Set([...current.sampleIds, ...(item.sampleIds ?? [])])].slice(0, WORK_LIMITS.problemSamples);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.source.localeCompare(right.source) || left.code.localeCompare(right.code));
}

/** Returns the earliest valid time. */
function earliestTime(values) { const times = values.map((value) => Date.parse(value)).filter(Number.isFinite); return times.length ? new Date(Math.min(...times)).toISOString() : null; }
/** Normalizes one optional time. */
function isoOrNull(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
/** Sorts normalized rows by identity. */
function byId(left, right) { return left.id.localeCompare(right.id); }
