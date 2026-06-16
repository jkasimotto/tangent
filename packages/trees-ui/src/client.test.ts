import { afterEach, describe, expect, it, vi } from "vitest";

import { createTreesApiClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

describe("trees api client", () => {
  it("loads workspace from the local Trees API", async () => {
    const fetchMock = mockFetch({ entities: [], projects: [{ id: "p1", name: "polez", path: "/repo/polez" }] });
    const client = createTreesApiClient();

    await expect(client.loadWorkspace()).resolves.toEqual({
      entities: [],
      projects: [{ id: "p1", name: "polez", path: "/repo/polez" }]
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/trees/workspace", { method: "GET", headers: undefined, body: undefined });
  });

  it("posts mutations and returns the refreshed workspace", async () => {
    const fetchMock = mockFetch({ entities: [{ id: "ent_foo", path: "foo", kind: "group" }], projects: [] });
    const client = createTreesApiClient();

    await client.createPath("foo");

    expect(fetchMock).toHaveBeenCalledWith("/api/trees/entities/path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "foo" })
    });
  });

  it("surfaces API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      /** Returns the mocked error body. */
      text: async () => JSON.stringify({ error: "Trees API unavailable." })
    })));

    await expect(createTreesApiClient().loadWorkspace()).rejects.toThrow("Trees API unavailable.");
  });
});

/** Installs a fetch mock that returns a workspace payload. */
function mockFetch(workspace: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    /** Returns the mocked JSON workspace body. */
    json: async () => workspace,
    /** Returns the mocked text workspace body. */
    text: async () => JSON.stringify(workspace)
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
