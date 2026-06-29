import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvalApiClient } from "./client.js";

afterEach(() => vi.restoreAllMocks());

describe("eval api client context methods", () => {
  it("builds the assemble URL with cwd and comma-joined skills", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ blocks: [], skills: [], subagents: [], lazyClaudeMd: [] }), { status: 200 })
    );
    const client = createEvalApiClient("");
    await client.assembleContext({ runId: "r1", caseId: "task", variant: "repo", cwd: "client/lib", skills: ["testing", "ui"] });
    const url = (fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("/api/eval/runs/r1/context/assemble?");
    expect(url).toContain("caseId=task");
    expect(url).toContain("variant=repo");
    expect(url).toContain("cwd=client%2Flib");
    expect(url).toContain("skills=testing%2Cui");
  });

  it("builds the manifest URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ skills: [], subagents: [] }), { status: 200 })
    );
    const client = createEvalApiClient("");
    await client.getContextManifest({ runId: "r1", caseId: "task", variant: "repo" });
    expect(fetchMock.mock.calls[0][0] as string).toContain("/api/eval/runs/r1/context/manifest?");
  });

  it("builds the conversations URL for one variant", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ schema: "eval.conversations.v1", caseId: "task", variantId: "repo", conversations: [], notes: [] }), { status: 200 })
    );
    const client = createEvalApiClient("");
    await client.getConversations({ runId: "r1", caseId: "task", variant: "repo" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/eval/runs/r1/conversations?");
    expect(url).toContain("caseId=task");
    expect(url).toContain("variant=repo");
  });
});
