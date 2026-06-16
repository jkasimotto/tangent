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
};

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
    }
  };
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
