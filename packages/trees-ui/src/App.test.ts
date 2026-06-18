import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { TreesUiClient, TreesUiWorkspace } from "./client.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("trees svelte app", () => {
  it("starts empty with the add-path form", async () => {
    render(App, { props: { client: fakeTreesClient() } });

    expect(await screen.findByText("No tree nodes yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add tree path")).toBeInTheDocument();
    expect(screen.getByLabelText("Tree summary")).toHaveTextContent("0 nodes");
  });

  it("adds a full path and renders expandable group-ready nodes", async () => {
    const client = fakeTreesClient();
    render(App, { props: { client } });

    await addPath("foo/bar");

    expect(client.createPath).toHaveBeenCalledWith("foo/bar");
    expect(await screen.findByRole("treeitem", { name: /foo/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: /bar/i })).toHaveTextContent("Unassigned");
    expect(screen.getByRole("heading", { name: "foo/bar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tree summary")).toHaveTextContent("2 nodes");
  });

  it("saves selected terminal node metadata as a locked leaf", async () => {
    const client = fakeTreesClient({
      entities: [
        entity("foo", "group"),
        entity("foo/bar", "work")
      ],
      projects: [project("p1", "otto-tangent")]
    });
    render(App, { props: { client } });

    await screen.findByRole("treeitem", { name: /foo/i });
    await fireEvent.click(screen.getByRole("button", { name: /bar/i }));
    await fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    await fireEvent.input(screen.getByLabelText("Branch"), { target: { value: "feature/trees-ui" } });
    await fireEvent.input(screen.getByLabelText("Worktree"), { target: { value: "/tmp/trees-ui" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save leaf" }));

    expect(client.saveLeaf).toHaveBeenCalledWith("ent_foo_bar", {
      projectId: "p1",
      branch: "feature/trees-ui",
      worktreePath: "/tmp/trees-ui"
    });
    expect(await screen.findByRole("treeitem", { name: /bar/i })).toHaveTextContent("otto-tangent · feature/trees-ui");
    expect(screen.getByText("Locked leaf")).toBeInTheDocument();
  });

  it("blocks adding descendants under a locked leaf", async () => {
    const client = fakeTreesClient({
      entities: [
        entity("foo", "group"),
        { ...entity("foo/bar", "work"), projectId: "p1", branch: "main" }
      ],
      projects: [project("p1", "otto-tangent")]
    });
    render(App, { props: { client } });

    await addPath("foo/bar/baz");

    expect(client.createPath).not.toHaveBeenCalledWith("foo/bar/baz");
    expect(await screen.findByRole("alert")).toHaveTextContent("foo/bar is configured as a leaf");
  });

  it("clears leaf metadata so children can be added later", async () => {
    const client = fakeTreesClient({
      entities: [
        entity("foo", "group"),
        { ...entity("foo/bar", "work"), projectId: "p1", branch: "main", worktreePath: "/tmp/main" }
      ],
      projects: [project("p1", "otto-tangent")]
    });
    render(App, { props: { client } });

    await screen.findByRole("treeitem", { name: /foo/i });
    await fireEvent.click(screen.getByRole("button", { name: /bar/i }));
    await fireEvent.click(screen.getByRole("button", { name: "Clear metadata" }));
    await addPath("foo/bar/baz");

    expect(client.clearLeaf).toHaveBeenCalledWith("ent_foo_bar");
    expect(client.createPath).toHaveBeenCalledWith("foo/bar/baz");
    expect(await screen.findByRole("treeitem", { name: /baz/i })).toBeInTheDocument();
  });

  it("requires registered projects before saving leaf metadata", async () => {
    render(App, {
      props: {
        client: fakeTreesClient({
          entities: [entity("foo", "work")],
          projects: []
        })
      }
    });

    await screen.findByRole("treeitem", { name: /foo/i });

    expect(screen.getByText("Register a project before locking leaves.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save leaf" })).toBeDisabled();
  });

  it("renders mixed nodes with children as group conflicts", async () => {
    render(App, {
      props: {
        client: fakeTreesClient({
          entities: [
            { ...entity("foo", "work"), projectId: "p1", branch: "main" },
            entity("foo/bar", "work")
          ],
          projects: [project("p1", "otto-tangent")]
        })
      }
    });

    expect(await screen.findByRole("treeitem", { name: /foo/i })).toHaveTextContent("Mixed");
    expect(screen.getByText("Group with leaf metadata")).toBeInTheDocument();
    expect(screen.getByText("This node has children and leaf metadata. Clear metadata to keep it as a group.")).toBeInTheDocument();
  });

  it("polls for workspace changes while preserving selection", async () => {
    vi.useFakeTimers();
    let workspace: TreesUiWorkspace = {
      entities: [entity("foo", "group")],
      projects: []
    };
    const client: TreesUiClient = {
      loadWorkspace: vi.fn(async () => clone(workspace)),
      createPath: vi.fn(),
      saveLeaf: vi.fn(),
      clearLeaf: vi.fn(),
      deleteEntity: vi.fn()
    };
    render(App, { props: { client } });

    expect(await screen.findByRole("heading", { name: "foo" })).toBeInTheDocument();
    workspace = {
      entities: [entity("foo", "group")],
      projects: [project("p1", "polez")]
    };

    await vi.advanceTimersByTimeAsync(2000);

    expect(client.loadWorkspace).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "foo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toHaveTextContent("polez");
  });
});

/** Adds a path through the visible form controls. */
async function addPath(path: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText("Add path"), { target: { value: path } });
  await fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

/** Creates a deterministic fake Trees client backed by local mutable state. */
function fakeTreesClient(initial: Partial<TreesUiWorkspace> = {}): TreesUiClient & {
  createPath: ReturnType<typeof vi.fn>;
  saveLeaf: ReturnType<typeof vi.fn>;
  clearLeaf: ReturnType<typeof vi.fn>;
  deleteEntity: ReturnType<typeof vi.fn>;
} {
  let workspace: TreesUiWorkspace = {
    entities: [...(initial.entities || [])],
    projects: [...(initial.projects || [])]
  };
  return {
    loadWorkspace: vi.fn(async () => clone(workspace)),
    createPath: vi.fn(async (path: string) => {
      const parts = path.split("/");
      for (let index = 0; index < parts.length; index += 1) {
        const nextPath = parts.slice(0, index + 1).join("/");
        if (!workspace.entities.some((candidate) => candidate.path === nextPath)) {
          workspace.entities.push(entity(nextPath, index === parts.length - 1 ? "work" : "group"));
        }
      }
      workspace = { ...workspace, entities: sortEntities(workspace.entities) };
      return clone(workspace);
    }),
    saveLeaf: vi.fn(async (ref: string, input: { projectId: string; branch: string; worktreePath?: string }) => {
      workspace = {
        ...workspace,
        entities: workspace.entities.map((item) => item.id === ref || item.path === ref ? { ...item, ...input, kind: "work" } : item)
      };
      return clone(workspace);
    }),
    clearLeaf: vi.fn(async (ref: string) => {
      workspace = {
        ...workspace,
        entities: workspace.entities.map((item) => item.id === ref || item.path === ref
          ? { ...item, kind: "group", projectId: undefined, branch: undefined, worktreePath: undefined }
          : item)
      };
      return clone(workspace);
    }),
    deleteEntity: vi.fn(async (ref: string) => {
      const target = workspace.entities.find((item) => item.id === ref || item.path === ref);
      if (!target) throw new Error(`Unknown tree entity: ${ref}`);
      const prefix = target.path + "/";
      workspace = {
        ...workspace,
        entities: workspace.entities.filter((item) => item.path !== target.path && !item.path.startsWith(prefix))
      };
      return clone(workspace);
    })
  };
}

/** Builds a compact entity fixture for a path. */
function entity(path: string, kind: "group" | "work") {
  return {
    id: `ent_${path.replaceAll("/", "_")}`,
    path,
    title: path.split("/").at(-1),
    kind
  };
}

/** Builds a compact project fixture. */
function project(id: string, name: string) {
  return {
    id,
    name,
    path: `/repo/${name}`
  };
}

/** Clones a workspace fixture for fake client responses. */
function clone(workspace: TreesUiWorkspace): TreesUiWorkspace {
  return {
    entities: sortEntities(workspace.entities).map((item) => ({ ...item })),
    projects: [...workspace.projects].sort((left, right) => left.name.localeCompare(right.name)).map((item) => ({ ...item }))
  };
}

/** Sorts fixture entities by path. */
function sortEntities(values: TreesUiWorkspace["entities"]): TreesUiWorkspace["entities"] {
  return [...values].sort((left, right) => left.path.localeCompare(right.path));
}
