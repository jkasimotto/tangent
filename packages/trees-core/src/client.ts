import { randomUUID } from "node:crypto";

import {
  normalizeTreeEntityKind,
  parentPathFor,
  titleFromPath,
  validateEntityPath,
  type ActorRef,
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

import { rebuildTreesProjection, type TreesProjection } from "./projection.js";
import type { TreeEventQuery, TreeEventStore } from "./store.js";
import { checkpointKindForOutcome, defaultActor, defaultSource, now, resolveEntityRef, resolveSessionRef } from "./helpers.js";

export type TreesClientOptions = {
  actor?: ActorRef;
  source?: TreeEvent["source"];
};

export type TreesClient = {
  events: {
    append(event: Partial<TreeEvent> & Pick<TreeEvent, "type" | "data">): Promise<TreeEvent>;
    query(query?: TreeEventQuery): Promise<TreeEvent[]>;
  };
  projection(): Promise<TreesProjection>;
  entities: {
    create(input: CreateEntityInput): Promise<TreeEntity>;
    list(pathPrefix?: string): Promise<TreeEntity[]>;
    get(ref: string): Promise<TreeEntity | undefined>;
    update(ref: string, patch: Partial<TreeEntity>): Promise<TreeEntity>;
    move(ref: string, toPath: string): Promise<TreeEntity>;
    delete(ref: string): Promise<void>;
  };
  projects: {
    add(name: string, path: string): Promise<ProjectRef>;
    list(): Promise<ProjectRef[]>;
    remove(nameOrId: string): Promise<void>;
  };
  sessions: {
    start(input: StartSessionInput): Promise<WorkSession>;
    checkpoint(ref: string, input: CheckpointInput): Promise<Checkpoint>;
    list(ref?: string): Promise<WorkSession[]>;
  };
  captures: {
    add(input: AddCaptureInput): Promise<Capture>;
    list(query?: { entity?: string; all?: boolean }): Promise<Capture[]>;
    resolve(id: string, input?: ResolveCaptureInput): Promise<Capture>;
    dismiss(id: string, note?: string): Promise<Capture>;
  };
  observations: {
    record(observation: Omit<TreeObservation, "schema" | "id" | "recordedAt"> & Partial<Pick<TreeObservation, "id" | "recordedAt">>): Promise<TreeObservation>;
  };
  attention: {
    upsert(items: AttentionItem[]): Promise<AttentionItem[]>;
    list(query?: { kind?: string; severity?: string; all?: boolean }): Promise<AttentionItem[]>;
    ack(id: string): Promise<AttentionItem>;
    resolve(id: string, note?: string): Promise<AttentionItem>;
    dismiss(id: string, reason?: string): Promise<AttentionItem>;
  };
  agents: {
    recordStarted(run: AgentRun): Promise<AgentRun>;
    patch(id: string, patch: Partial<AgentRun>, eventType?: string): Promise<AgentRun>;
  };
  terminals: {
    recordCreated(session: TerminalSession): Promise<TerminalSession>;
    patch(id: string, patch: Partial<TerminalSession>, eventType?: string): Promise<TerminalSession>;
  };
};

export type CreateEntityInput = {
  path: string;
  kind?: string;
  projectId?: string;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  title?: string;
  description?: string;
  tags?: string[];
  agentDefaults?: TreeEntity["agentDefaults"];
  providerFields?: Record<string, unknown>;
};

export type StartSessionInput = {
  entity: string;
  intent?: string;
  doneWhen?: string;
  estimate?: WorkSession["estimate"];
};

export type CheckpointInput = {
  outcome?: Checkpoint["outcome"];
  kind?: Checkpoint["kind"];
  actual?: Checkpoint["actual"];
  did?: string;
  learned?: string;
  evidenceText?: string;
  next?: string;
  blocker?: string;
  raw?: string;
  linkedCaptureIds?: string[];
  linkedAttentionItemIds?: string[];
};

export type AddCaptureInput = {
  entity?: string;
  workSessionId?: string;
  agentRunId?: string;
  kind?: Capture["kind"];
  text: string;
};

export type ResolveCaptureInput = {
  checkpointId?: string;
  note?: string;
};

/** Documents the createTreesClient helper. */
export function createTreesClient(store: TreeEventStore, options: TreesClientOptions = {}): TreesClient {
  const actor = options.actor || defaultActor();
  const source = options.source || defaultSource("trees-cli");

  /** Documents the append helper. */
  const append = async (input: Partial<TreeEvent> & Pick<TreeEvent, "type" | "data">): Promise<TreeEvent> => {
    const event: TreeEvent = {
      schema: "tangent.trees.event.v1",
      id: input.id || `evt_${randomUUID()}`,
      type: input.type,
      at: input.at || now(),
      actor: input.actor || actor,
      source: input.source || source,
      entityId: input.entityId,
      workSessionId: input.workSessionId,
      agentRunId: input.agentRunId,
      terminalSessionId: input.terminalSessionId,
      attentionItemId: input.attentionItemId,
      captureId: input.captureId,
      checkpointId: input.checkpointId,
      data: input.data,
      causationId: input.causationId,
      correlationId: input.correlationId,
      evidence: input.evidence || []
    };
    return store.append(event);
  };

  /** Documents the projection helper. */
  const projection = async () => rebuildTreesProjection(await store.query());
  /** Documents the entityByRef helper. */
  const entityByRef = async (ref: string) => resolveEntityRef((await projection()).entities, ref);
  /** Documents the query helper. */
  const query = async (eventQuery?: TreeEventQuery) => store.query(eventQuery);

  return {
    events: { append, query },
    projection,
    entities: {
      /** Documents the create helper. */
      async create(input) {
        const path = validateEntityPath(input.path);
        const at = now();
        const entity: TreeEntity = {
          schema: "tangent.trees.entity.v1",
          id: `ent_${randomUUID()}`,
          path,
          parentPath: parentPathFor(path),
          title: input.title || titleFromPath(path),
          kind: normalizeTreeEntityKind(input.kind),
          projectId: input.projectId,
          repoRoot: input.repoRoot,
          worktreePath: input.worktreePath,
          branch: input.branch,
          agentDefaults: input.agentDefaults,
          description: input.description,
          tags: input.tags || [],
          createdAt: at,
          updatedAt: at,
          providerFields: input.providerFields
        };
        await append({ type: "entity.created", entityId: entity.id, data: { entity } });
        return entity;
      },
      /** Documents the list helper. */
      async list(pathPrefix) {
        const entities = (await projection()).entities;
        return pathPrefix ? entities.filter((entity) => entity.path === pathPrefix || entity.path.startsWith(`${pathPrefix}/`)) : entities;
      },
      get: entityByRef,
      /** Documents the update helper. */
      async update(ref, patch) {
        const entity = required(await entityByRef(ref), `Unknown tree entity: ${ref}`);
        const normalizedPatch = patch.path ? { ...patch, path: validateEntityPath(patch.path), parentPath: parentPathFor(patch.path) } : patch;
        await append({ type: "entity.updated", entityId: entity.id, data: { patch: normalizedPatch } });
        return required(await entityByRef(entity.id), `Updated tree entity disappeared: ${entity.id}`);
      },
      /** Documents the move helper. */
      async move(ref, toPath) {
        const entity = required(await entityByRef(ref), `Unknown tree entity: ${ref}`);
        const normalized = validateEntityPath(toPath);
        await append({ type: "entity.moved", entityId: entity.id, data: { fromPath: entity.path, toPath: normalized } });
        return required(await entityByRef(entity.id), `Moved tree entity disappeared: ${entity.id}`);
      },
      /** Documents the delete helper. */
      async delete(ref) {
        const entity = required(await entityByRef(ref), `Unknown tree entity: ${ref}`);
        await append({ type: "entity.deleted", entityId: entity.id, data: { path: entity.path } });
      }
    },
    projects: {
      /** Documents the add helper. */
      async add(name, projectPath) {
        const at = now();
        const project: ProjectRef = {
          schema: "tangent.trees.project.v1",
          id: `prj_${randomUUID()}`,
          name,
          path: projectPath,
          createdAt: at,
          updatedAt: at,
          evidence: []
        };
        await append({ type: "project.registered", data: { project } });
        return project;
      },
      /** Documents the list helper. */
      async list() {
        return (await projection()).projects;
      },
      /** Documents the remove helper. */
      async remove(nameOrId) {
        const project = (await projection()).projects.find((candidate) => candidate.id === nameOrId || candidate.name === nameOrId);
        if (!project) throw new Error(`Unknown tree project: ${nameOrId}`);
        await append({ type: "project.removed", data: { projectId: project.id, name: project.name } });
      }
    },
    sessions: {
      /** Documents the start helper. */
      async start(input) {
        const entity = required(await entityByRef(input.entity), `Unknown tree entity: ${input.entity}`);
        const existing = (await projection()).workSessions.find((session) => session.entityId === entity.id && session.status === "active");
        if (existing) return existing;
        const at = now();
        const workSession: WorkSession = {
          schema: "tangent.trees.workSession.v1",
          id: `ws_${randomUUID()}`,
          entityId: entity.id,
          entityPath: entity.path,
          status: "active",
          intent: input.intent,
          doneWhen: input.doneWhen,
          estimate: input.estimate,
          startedAt: at,
          startedBy: actor,
          agentRunIds: [],
          terminalSessionIds: [],
          usageSessionIds: [],
          checkpointIds: [],
          captureIds: [],
          createdAt: at,
          updatedAt: at,
          evidence: []
        };
        await append({ type: "workSession.started", entityId: entity.id, workSessionId: workSession.id, data: { workSession } });
        return workSession;
      },
      /** Documents the checkpoint helper. */
      async checkpoint(ref, input) {
        const view = await projection();
        const session = resolveSessionRef(view.workSessions, view.entities, ref);
        if (!session) throw new Error(`Unknown tree work session: ${ref}`);
        const at = now();
        const outcome = input.outcome || "continue";
        const checkpoint: Checkpoint = {
          schema: "tangent.trees.checkpoint.v1",
          id: `chk_${randomUUID()}`,
          workSessionId: session.id,
          entityId: session.entityId,
          kind: input.kind || checkpointKindForOutcome(outcome),
          outcome,
          actual: input.actual,
          did: input.did,
          learned: input.learned,
          evidenceText: input.evidenceText,
          next: input.next,
          blocker: input.blocker,
          raw: input.raw,
          linkedCaptureIds: input.linkedCaptureIds || [],
          linkedAttentionItemIds: input.linkedAttentionItemIds || [],
          createdAt: at,
          createdBy: actor,
          source,
          evidence: []
        };
        await append({ type: "workSession.checkpointed", entityId: session.entityId, workSessionId: session.id, checkpointId: checkpoint.id, data: { checkpoint } });
        return checkpoint;
      },
      /** Documents the list helper. */
      async list(ref) {
        const view = await projection();
        if (!ref) return view.workSessions;
        const entity = resolveEntityRef(view.entities, ref);
        return view.workSessions.filter((session) => session.id === ref || session.entityId === entity?.id);
      }
    },
    captures: {
      /** Documents the add helper. */
      async add(input) {
        const entity = input.entity ? await entityByRef(input.entity) : undefined;
        const at = now();
        const capture: Capture = {
          schema: "tangent.trees.capture.v1",
          id: `cap_${randomUUID()}`,
          entityId: entity?.id,
          workSessionId: input.workSessionId,
          agentRunId: input.agentRunId,
          kind: input.kind || "note",
          text: input.text,
          status: "open",
          source,
          createdBy: actor,
          createdAt: at,
          evidence: []
        };
        await append({ type: "capture.created", entityId: entity?.id, workSessionId: input.workSessionId, agentRunId: input.agentRunId, captureId: capture.id, data: { capture } });
        return capture;
      },
      /** Documents the list helper. */
      async list(query = {}) {
        const view = await projection();
        const entity = query.entity ? resolveEntityRef(view.entities, query.entity) : undefined;
        return view.captures.filter((capture) => (query.all || capture.status === "open") && (!query.entity || capture.entityId === entity?.id));
      },
      /** Documents the resolve helper. */
      async resolve(id, input = {}) {
        const capture = required((await projection()).captures.find((candidate) => candidate.id === id), `Unknown capture: ${id}`);
        await append({ type: "capture.resolved", captureId: id, data: { targetId: input.checkpointId, note: input.note } });
        return { ...capture, status: "resolved", resolvedAt: now(), resolvedBy: actor, resolution: { kind: input.checkpointId ? "checkpoint" : "other", targetId: input.checkpointId, note: input.note } };
      },
      /** Documents the dismiss helper. */
      async dismiss(id, note) {
        const capture = required((await projection()).captures.find((candidate) => candidate.id === id), `Unknown capture: ${id}`);
        await append({ type: "capture.dismissed", captureId: id, data: { note } });
        return { ...capture, status: "dismissed", resolvedAt: now(), resolvedBy: actor, resolution: { kind: "dismissed", note } };
      }
    },
    observations: {
      /** Documents the record helper. */
      async record(input) {
        const observation: TreeObservation = { ...input, schema: "tangent.trees.observation.v1", id: input.id || `obs_${randomUUID()}`, recordedAt: input.recordedAt || now() };
        await append({ type: "observation.recorded", entityId: observation.subject.entityId, workSessionId: observation.subject.workSessionId, agentRunId: observation.subject.agentRunId, terminalSessionId: observation.subject.terminalSessionId, data: { observation }, evidence: observation.evidence });
        return observation;
      }
    },
    attention: {
      /** Documents the upsert helper. */
      async upsert(items) {
        for (const item of items) await append({ type: "attention.created", entityId: item.entityId, workSessionId: item.workSessionId, agentRunId: item.agentRunId, terminalSessionId: item.terminalSessionId, attentionItemId: item.id, data: { attentionItem: item }, evidence: item.evidence });
        return items;
      },
      /** Documents the list helper. */
      async list(query = {}) {
        return (await projection()).attentionItems.filter((item) => (query.all || item.status === "open") && (!query.kind || item.kind === query.kind) && (!query.severity || item.severity === query.severity));
      },
      /** Documents the ack helper. */
      async ack(id) {
        return patchAttention(append, projection, id, { status: "acknowledged" }, "attention.acknowledged");
      },
      /** Documents the resolve helper. */
      async resolve(id) {
        return patchAttention(append, projection, id, { status: "resolved", resolvedAt: now() }, "attention.resolved");
      },
      /** Documents the dismiss helper. */
      async dismiss(id) {
        return patchAttention(append, projection, id, { status: "dismissed", resolvedAt: now() }, "attention.dismissed");
      }
    },
    agents: {
      /** Documents the recordStarted helper. */
      async recordStarted(run) {
        await append({ type: "agent.started", entityId: run.entityId, workSessionId: run.workSessionId, agentRunId: run.id, terminalSessionId: run.terminalSessionId, data: { agentRun: run }, evidence: run.evidence });
        return run;
      },
      /** Documents the patch helper. */
      async patch(id, patch, eventType = "agent.statusObserved") {
        await append({ type: eventType, agentRunId: id, data: { patch } });
        return required((await projection()).agentRuns.find((run) => run.id === id), `Unknown agent run: ${id}`);
      }
    },
    terminals: {
      /** Documents the recordCreated helper. */
      async recordCreated(session) {
        await append({ type: "terminal.created", entityId: session.entityId, workSessionId: session.workSessionId, agentRunId: session.agentRunId, terminalSessionId: session.id, data: { terminalSession: session }, evidence: session.evidence });
        return session;
      },
      /** Documents the patch helper. */
      async patch(id, patch, eventType = "terminal.started") {
        await append({ type: eventType, terminalSessionId: id, data: { patch } });
        return required((await projection()).terminalSessions.find((session) => session.id === id), `Unknown terminal session: ${id}`);
      }
    }
  };
}

/** Documents the patchAttention helper. */
async function patchAttention(
  append: TreesClient["events"]["append"],
  projection: TreesClient["projection"],
  id: string,
  patch: Partial<AttentionItem>,
  type: string
): Promise<AttentionItem> {
  const item = required((await projection()).attentionItems.find((candidate) => candidate.id === id), `Unknown attention item: ${id}`);
  await append({ type, attentionItemId: id, data: { patch } });
  return { ...item, ...patch, updatedAt: now() };
}

/** Documents the required helper. */
function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
