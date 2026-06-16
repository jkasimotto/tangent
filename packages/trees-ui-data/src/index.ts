import type { TreesProjection } from "@tangent/trees-core";
import type { AgentRun, AttentionItem, TerminalSession, TreeEntity, WorkSession } from "@tangent/trees-schema";

export type TreesCenterView = {
  schema: "tangent.trees.center.v1";
  generatedAt: string;
  tree: TreesTreeNode[];
  attention: TreesAttentionRow[];
  activeAgents: TreesAgentRow[];
  selected?: TreesInspectorView;
  counts: {
    entities: number;
    openAttention: number;
    activeAgents: number;
    activeSessions: number;
  };
};

export type TreesTreeNode = {
  id: string;
  path: string;
  title: string;
  kind: string;
  status?: string;
  attentionOpen: number;
  children: TreesTreeNode[];
};

export type TreesAttentionRow = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body?: string;
  entityPath?: string;
  priority: number;
  updatedAt: string;
};

export type TreesAgentRow = {
  id: string;
  adapterId: string;
  status: string;
  statusReason?: string;
  entityPath?: string;
  startedAt: string;
  lastActivityAt?: string;
  terminalSessionId?: string;
};

export type TreesInspectorView = {
  entity?: TreeEntity;
  workSessions: WorkSession[];
  agentRuns: AgentRun[];
  terminalSessions: TerminalSession[];
  attention: AttentionItem[];
};

export interface TreesCenterClient {
  getCenter(path?: string): Promise<TreesCenterView>;
}

/** Documents the createTreesCenterApiClient helper. */
export function createTreesCenterApiClient(baseUrl = ""): TreesCenterClient {
  return {
    /** Documents the getCenter helper. */
    async getCenter(path) {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      const token = browserToken();
      if (token) params.set("token", token);
      const query = params.size ? `?${params}` : "";
      const response = await fetch(`${baseUrl}/api/trees/center${query}`);
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<TreesCenterView>;
    }
  };
}

/** Documents the buildTreesCenterView helper. */
export function buildTreesCenterView(projection: TreesProjection, options: { selectedRef?: string } = {}): TreesCenterView {
  const selected = options.selectedRef ? resolveSelected(projection, options.selectedRef) : projection.entities[0];
  const entityById = new Map(projection.entities.map((entity) => [entity.id, entity]));
  const openAttention = projection.attentionItems.filter((item) => item.status === "open");
  const activeAgents = projection.agentRuns.filter((run) => run.status === "starting" || run.status === "running" || run.status === "quiet" || run.status === "waiting_permission");
  return {
    schema: "tangent.trees.center.v1",
    generatedAt: new Date().toISOString(),
    tree: buildTree(projection.entities, openAttention),
    attention: openAttention.map((item) => ({
      id: item.id,
      kind: item.kind,
      severity: item.severity,
      title: item.title,
      body: item.body,
      entityPath: item.entityId ? entityById.get(item.entityId)?.path : undefined,
      priority: item.priority,
      updatedAt: item.updatedAt
    })),
    activeAgents: activeAgents.map((run) => ({
      id: run.id,
      adapterId: run.adapterId,
      status: run.status,
      statusReason: run.statusReason,
      entityPath: entityById.get(run.entityId)?.path,
      startedAt: run.startedAt,
      lastActivityAt: run.lastActivityAt,
      terminalSessionId: run.terminalSessionId
    })),
    selected: selected ? inspectorFor(projection, selected) : undefined,
    counts: {
      entities: projection.entities.length,
      openAttention: openAttention.length,
      activeAgents: activeAgents.length,
      activeSessions: projection.workSessions.filter((session) => session.status === "active").length
    }
  };
}

/** Documents the buildTree helper. */
function buildTree(entities: TreeEntity[], attention: AttentionItem[]): TreesTreeNode[] {
  const nodes = new Map<string, TreesTreeNode>();
  for (const entity of entities) {
    nodes.set(entity.path, {
      id: entity.id,
      path: entity.path,
      title: entity.title,
      kind: entity.kind,
      status: entity.statusSummary?.status,
      attentionOpen: attention.filter((item) => item.entityId === entity.id).length,
      children: []
    });
  }
  const roots: TreesTreeNode[] = [];
  for (const entity of entities) {
    const node = nodes.get(entity.path)!;
    if (entity.parentPath && nodes.has(entity.parentPath)) nodes.get(entity.parentPath)!.children.push(node);
    else roots.push(node);
  }
  /** Documents the sort helper. */
  const sort = (items: TreesTreeNode[]) => {
    items.sort((a, b) => a.path.localeCompare(b.path));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

/** Documents the resolveSelected helper. */
function resolveSelected(projection: TreesProjection, ref: string): TreeEntity | undefined {
  return projection.entities.find((entity) => entity.id === ref || entity.path === ref || entity.path.endsWith(`/${ref}`));
}

/** Documents the inspectorFor helper. */
function inspectorFor(projection: TreesProjection, entity: TreeEntity): TreesInspectorView {
  return {
    entity,
    workSessions: projection.workSessions.filter((session) => session.entityId === entity.id),
    agentRuns: projection.agentRuns.filter((run) => run.entityId === entity.id),
    terminalSessions: projection.terminalSessions.filter((session) => session.entityId === entity.id),
    attention: projection.attentionItems.filter((item) => item.entityId === entity.id && item.status === "open")
  };
}

/** Documents the browserToken helper. */
function browserToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("token") || undefined;
}
