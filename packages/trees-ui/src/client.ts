export type TreesUiWorkspace = {
  entities: TreesUiEntity[];
  projects: TreesUiProject[];
};

export type TreesUiEntity = {
  id: string;
  path: string;
  title?: string;
  projectId?: string;
  branch?: string;
  worktreePath?: string;
  kind?: "group" | "work" | string;
};

export type TreesUiProject = {
  id: string;
  name: string;
  path: string;
};

export type TreesUiClient = {
  loadWorkspace(): Promise<TreesUiWorkspace>;
  createPath(path: string): Promise<TreesUiWorkspace>;
  saveLeaf(ref: string, input: { projectId: string; branch: string; worktreePath?: string }): Promise<TreesUiWorkspace>;
  clearLeaf(ref: string): Promise<TreesUiWorkspace>;
  deleteEntity(ref: string): Promise<TreesUiWorkspace>;
};

/** Creates a browser client backed by the local Trees HTTP API. */
export function createTreesApiClient(basePath = "/api/trees"): TreesUiClient {
  return {
    /** Loads the current workspace from the Trees API. */
    async loadWorkspace() {
      return requestWorkspace(`${basePath}/workspace`);
    },
    /** Creates a semantic path through the Trees API. */
    async createPath(path) {
      return requestWorkspace(`${basePath}/entities/path`, { method: "POST", body: { path } });
    },
    /** Saves leaf metadata through the Trees API. */
    async saveLeaf(ref, input) {
      return requestWorkspace(`${basePath}/entities/${encodeURIComponent(ref)}/leaf`, { method: "POST", body: input });
    },
    /** Clears leaf metadata through the Trees API. */
    async clearLeaf(ref) {
      return requestWorkspace(`${basePath}/entities/${encodeURIComponent(ref)}/leaf/clear`, { method: "POST" });
    },
    /** Deletes an entity and all its descendants through the Trees API. */
    async deleteEntity(ref) {
      return requestWorkspace(`${basePath}/entities/${encodeURIComponent(ref)}/delete`, { method: "POST" });
    }
  };
}

/** Creates an in-memory Trees UI client for local previews and component tests. */
export function createMemoryTreesUiClient(initial: Partial<TreesUiWorkspace> = {}): TreesUiClient {
  let workspace: TreesUiWorkspace = {
    entities: [...(initial.entities || [])],
    projects: [...(initial.projects || [])]
  };

  return {
    /** Loads the current in-memory workspace snapshot. */
    async loadWorkspace() {
      return cloneWorkspace(workspace);
    },
    /** Creates any missing segments for a slash-delimited tree path. */
    async createPath(rawPath) {
      const path = normalizeTreePath(rawPath);
      const segments = path.split("/");
      const entities = [...workspace.entities];
      for (let index = 0; index < segments.length; index += 1) {
        const nextPath = segments.slice(0, index + 1).join("/");
        if (!entities.some((entity) => entity.path === nextPath)) {
          entities.push({
            id: `local:${nextPath}`,
            path: nextPath,
            title: segments[index],
            kind: index === segments.length - 1 ? "work" : "group"
          });
        }
      }
      workspace = { ...workspace, entities: sortEntities(entities) };
      return cloneWorkspace(workspace);
    },
    /** Saves project, branch, and optional worktree metadata on a leaf node. */
    async saveLeaf(ref, input) {
      workspace = {
        ...workspace,
        entities: workspace.entities.map((entity) => entity.id === ref || entity.path === ref
          ? { ...entity, kind: "work", projectId: input.projectId, branch: input.branch, worktreePath: input.worktreePath || undefined }
          : entity)
      };
      return cloneWorkspace(workspace);
    },
    /** Clears leaf metadata so a node can behave like a group again. */
    async clearLeaf(ref) {
      workspace = {
        ...workspace,
        entities: workspace.entities.map((entity) => entity.id === ref || entity.path === ref
          ? { ...entity, kind: "group", projectId: undefined, branch: undefined, worktreePath: undefined }
          : entity)
      };
      return cloneWorkspace(workspace);
    },
    /** Deletes an entity and all its descendants. */
    async deleteEntity(ref) {
      const target = workspace.entities.find((e) => e.id === ref || e.path === ref);
      if (!target) throw new Error(`Unknown tree entity: ${ref}`);
      const prefix = target.path + "/";
      workspace = {
        ...workspace,
        entities: workspace.entities.filter((e) => e.path !== target.path && !e.path.startsWith(prefix))
      };
      return cloneWorkspace(workspace);
    }
  };
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
};

/** Requests and validates a Trees workspace response. */
async function requestWorkspace(url: string, options: RequestOptions = {}): Promise<TreesUiWorkspace> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) throw new Error(await responseError(response));
  const value = await response.json() as Partial<TreesUiWorkspace>;
  return {
    entities: Array.isArray(value.entities) ? value.entities : [],
    projects: Array.isArray(value.projects) ? value.projects : []
  };
}

/** Reads a useful error message from a failed API response. */
async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Fall back to the raw response text below.
  }
  if (text.includes("<!doctype") || text.includes("<html")) return "Trees API unavailable. Start the app through `tangent ui trees`.";
  return text.trim() || `Trees API request failed with ${response.status}.`;
}

/** Normalizes and validates user-entered tree paths. */
function normalizeTreePath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("Path is required.");
  if (path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid tree path.");
  return path;
}

/** Sorts tree entities by semantic path for stable display. */
function sortEntities(values: TreesUiEntity[]): TreesUiEntity[] {
  return [...values].sort((left, right) => left.path.localeCompare(right.path));
}

/** Clones workspace arrays so callers cannot mutate the backing store. */
function cloneWorkspace(workspace: TreesUiWorkspace): TreesUiWorkspace {
  return {
    entities: workspace.entities.map((entity) => ({ ...entity })),
    projects: workspace.projects.map((project) => ({ ...project }))
  };
}
