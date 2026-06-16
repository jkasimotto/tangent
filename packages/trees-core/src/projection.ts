import {
  parentPathFor,
  type AgentRun,
  type AttentionItem,
  type Capture,
  type Checkpoint,
  type ProjectRef,
  type TerminalSession,
  type TreeEntity,
  type TreeEvent,
  type TreeObservation,
  type WorkSession
} from "@tangent/trees-schema";

export type TreesProjection = {
  events: TreeEvent[];
  entities: TreeEntity[];
  projects: ProjectRef[];
  workSessions: WorkSession[];
  checkpoints: Checkpoint[];
  captures: Capture[];
  agentRuns: AgentRun[];
  terminalSessions: TerminalSession[];
  observations: TreeObservation[];
  attentionItems: AttentionItem[];
};

/** Documents the emptyTreesProjection helper. */
export function emptyTreesProjection(): TreesProjection {
  return {
    events: [],
    entities: [],
    projects: [],
    workSessions: [],
    checkpoints: [],
    captures: [],
    agentRuns: [],
    terminalSessions: [],
    observations: [],
    attentionItems: []
  };
}

/** Documents the rebuildTreesProjection helper. */
export function rebuildTreesProjection(events: TreeEvent[]): TreesProjection {
  const projection = emptyTreesProjection();
  const entities = new Map<string, TreeEntity>();
  const projects = new Map<string, ProjectRef>();
  const sessions = new Map<string, WorkSession>();
  const checkpoints = new Map<string, Checkpoint>();
  const captures = new Map<string, Capture>();
  const agents = new Map<string, AgentRun>();
  const terminals = new Map<string, TerminalSession>();
  const observations = new Map<string, TreeObservation>();
  const attention = new Map<string, AttentionItem>();

  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    projection.events.push(event);
    applyEvent(event, { entities, projects, sessions, checkpoints, captures, agents, terminals, observations, attention });
  }

  projection.entities = [...entities.values()].sort((a, b) => a.path.localeCompare(b.path));
  projection.projects = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  projection.workSessions = [...sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  projection.checkpoints = [...checkpoints.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  projection.captures = [...captures.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  projection.agentRuns = [...agents.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  projection.terminalSessions = [...terminals.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  projection.observations = [...observations.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  projection.attentionItems = [...attention.values()].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  return projection;
}

type Maps = {
  entities: Map<string, TreeEntity>;
  projects: Map<string, ProjectRef>;
  sessions: Map<string, WorkSession>;
  checkpoints: Map<string, Checkpoint>;
  captures: Map<string, Capture>;
  agents: Map<string, AgentRun>;
  terminals: Map<string, TerminalSession>;
  observations: Map<string, TreeObservation>;
  attention: Map<string, AttentionItem>;
};

/** Documents the applyEvent helper. */
function applyEvent(event: TreeEvent, maps: Maps): void {
  const data = event.data as Record<string, unknown>;
  if (event.type === "entity.created" || event.type === "entity.updated") {
    const entity = data.entity as TreeEntity | undefined;
    const patch = data.patch as Partial<TreeEntity> | undefined;
    if (entity) maps.entities.set(entity.id, entity);
    else if (event.entityId && patch) patchEntity(maps.entities, event.entityId, patch, event.at);
    return;
  }
  if (event.type === "entity.moved") {
    moveEntityPaths(maps.entities, String(data.fromPath), String(data.toPath), event.at);
    return;
  }
  if (event.type === "entity.deleted" && event.entityId) {
    deleteEntityAndChildren(maps.entities, event.entityId);
    return;
  }
  if (event.type === "project.registered" || event.type === "project.updated") {
    const project = data.project as ProjectRef | undefined;
    if (project) maps.projects.set(project.id, project);
    return;
  }
  if (event.type === "project.removed" && data.projectId) {
    maps.projects.delete(String(data.projectId));
    return;
  }
  if (event.type === "workSession.started") {
    const session = data.workSession as WorkSession | undefined;
    if (session) maps.sessions.set(session.id, session);
    return;
  }
  if (event.type === "workSession.checkpointed") {
    const checkpoint = data.checkpoint as Checkpoint | undefined;
    if (!checkpoint) return;
    maps.checkpoints.set(checkpoint.id, checkpoint);
    const session = maps.sessions.get(checkpoint.workSessionId);
    if (session) {
      const status = checkpoint.outcome === "continue" ? session.status : checkpoint.outcome;
      maps.sessions.set(session.id, {
        ...session,
        status,
        endedAt: status === "active" ? session.endedAt : checkpoint.createdAt,
        endedBy: status === "active" ? session.endedBy : checkpoint.createdBy,
        checkpointIds: unique([...session.checkpointIds, checkpoint.id]),
        captureIds: unique([...session.captureIds, ...checkpoint.linkedCaptureIds]),
        updatedAt: checkpoint.createdAt
      });
    }
    for (const captureId of checkpoint.linkedCaptureIds) resolveCapture(maps.captures, captureId, checkpoint.createdAt, checkpoint.createdBy, "checkpoint", checkpoint.id);
    for (const itemId of checkpoint.linkedAttentionItemIds) resolveAttention(maps.attention, itemId, checkpoint.createdAt);
    return;
  }
  if (event.type === "workSession.ended" && event.workSessionId) {
    patchSession(maps.sessions, event.workSessionId, data.patch as Partial<WorkSession>, event.at);
    return;
  }
  if (event.type === "capture.created") {
    const capture = data.capture as Capture | undefined;
    if (capture) maps.captures.set(capture.id, capture);
    return;
  }
  if (event.type === "capture.resolved" && event.captureId) {
    resolveCapture(maps.captures, event.captureId, event.at, event.actor, "other", String(data.targetId || ""));
    return;
  }
  if (event.type === "capture.dismissed" && event.captureId) {
    const capture = maps.captures.get(event.captureId);
    if (capture) maps.captures.set(capture.id, {
      ...capture,
      status: "dismissed",
      resolvedAt: event.at,
      resolvedBy: event.actor,
      resolution: { kind: "dismissed", note: typeof data.note === "string" ? data.note : undefined }
    });
    return;
  }
  if (event.type === "agent.started" || event.type === "agent.statusObserved" || event.type === "agent.completed" || event.type === "agent.failed" || event.type === "agent.cancelled") {
    upsertAgent(maps.agents, data.agentRun as AgentRun | undefined, event.agentRunId, data.patch as Partial<AgentRun> | undefined, event.at);
    return;
  }
  if (event.type === "terminal.created" || event.type === "terminal.started" || event.type === "terminal.exited" || event.type === "terminal.killed" || event.type === "terminal.attached" || event.type === "terminal.detached") {
    upsertTerminal(maps.terminals, data.terminalSession as TerminalSession | undefined, event.terminalSessionId, data.patch as Partial<TerminalSession> | undefined);
    return;
  }
  if (event.type === "observation.recorded") {
    const observation = data.observation as TreeObservation | undefined;
    if (observation) maps.observations.set(observation.id, observation);
    return;
  }
  if (event.type === "attention.created" || event.type === "attention.resolved" || event.type === "attention.acknowledged" || event.type === "attention.dismissed") {
    upsertAttention(maps.attention, data.attentionItem as AttentionItem | undefined, event.attentionItemId, data.patch as Partial<AttentionItem> | undefined, event.at);
  }
}

/** Documents the patchEntity helper. */
function patchEntity(entities: Map<string, TreeEntity>, id: string, patch: Partial<TreeEntity>, at: string): void {
  const entity = entities.get(id);
  if (entity) entities.set(id, { ...entity, ...patch, updatedAt: at });
}

/** Documents the moveEntityPaths helper. */
function moveEntityPaths(entities: Map<string, TreeEntity>, fromPath: string, toPath: string, at: string): void {
  for (const entity of [...entities.values()]) {
    if (entity.path !== fromPath && !entity.path.startsWith(`${fromPath}/`)) continue;
    const movedPath = entity.path === fromPath ? toPath : `${toPath}${entity.path.slice(fromPath.length)}`;
    entities.set(entity.id, { ...entity, path: movedPath, parentPath: parentPathFor(movedPath), updatedAt: at });
  }
}

/** Documents the deleteEntityAndChildren helper. */
function deleteEntityAndChildren(entities: Map<string, TreeEntity>, id: string): void {
  const entity = entities.get(id);
  if (!entity) return;
  for (const candidate of [...entities.values()]) {
    if (candidate.path === entity.path || candidate.path.startsWith(`${entity.path}/`)) entities.delete(candidate.id);
  }
}

/** Documents the patchSession helper. */
function patchSession(sessions: Map<string, WorkSession>, id: string, patch: Partial<WorkSession>, at: string): void {
  const session = sessions.get(id);
  if (session) sessions.set(id, { ...session, ...patch, updatedAt: at });
}

/** Documents the resolveCapture helper. */
function resolveCapture(captures: Map<string, Capture>, id: string, at: string, actor: Capture["resolvedBy"], kind: NonNullable<Capture["resolution"]>["kind"], targetId?: string): void {
  const capture = captures.get(id);
  if (!capture) return;
  captures.set(id, { ...capture, status: "resolved", resolvedAt: at, resolvedBy: actor, resolution: { kind, targetId } });
}

/** Documents the resolveAttention helper. */
function resolveAttention(attention: Map<string, AttentionItem>, id: string, at: string): void {
  const item = attention.get(id);
  if (item) attention.set(id, { ...item, status: "resolved", resolvedAt: at, updatedAt: at });
}

/** Documents the upsertAgent helper. */
function upsertAgent(agents: Map<string, AgentRun>, run: AgentRun | undefined, id: string | undefined, patch: Partial<AgentRun> | undefined, at: string): void {
  if (run) agents.set(run.id, run);
  else if (id && patch && agents.has(id)) agents.set(id, { ...agents.get(id)!, ...patch, updatedAt: at });
}

/** Documents the upsertTerminal helper. */
function upsertTerminal(terminals: Map<string, TerminalSession>, session: TerminalSession | undefined, id: string | undefined, patch: Partial<TerminalSession> | undefined): void {
  if (session) terminals.set(session.id, session);
  else if (id && patch && terminals.has(id)) terminals.set(id, { ...terminals.get(id)!, ...patch });
}

/** Documents the upsertAttention helper. */
function upsertAttention(attention: Map<string, AttentionItem>, item: AttentionItem | undefined, id: string | undefined, patch: Partial<AttentionItem> | undefined, at: string): void {
  if (item) attention.set(item.id, item);
  else if (id && patch && attention.has(id)) attention.set(id, { ...attention.get(id)!, ...patch, updatedAt: at });
}

/** Documents the unique helper. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
