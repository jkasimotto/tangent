import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import MarksInbox from "./MarksInbox.svelte";
import type { EvalUiClient, MarkListFilter, MarkRecord, MarkUpdatePatch } from "./client.js";

afterEach(() => cleanup());

/** Builds a mark fixture, filling only the fields MarksInbox reads. */
function mark(overrides: Partial<MarkRecord> = {}): MarkRecord {
  return {
    schema: "tangent.mark.v1",
    id: "20260705T143012-you-should-have-read",
    at: "2026-07-05T14:30:12.000Z",
    kind: "failure",
    anchor: { provider: "claude", sessionId: "session-abc", conversationId: "claude:session-abc", transcriptPath: "/x/session-abc.jsonl" },
    repo: { root: "/Users/me/Projects/otto-tangent" },
    observed: "greped the codebase for six minutes instead of reading docs/index.md",
    expected: "should have read docs/index.md first",
    hypothesis: "CLAUDE.md never points at docs/index.md",
    status: "new",
    links: { eval: null, fix: null },
    ...overrides
  };
}

/**
 * A minimal client fake for MarksInbox tests: only the marks methods are meaningfully implemented, cast to
 * the full `EvalUiClient` since the component only ever calls `listMarks`/`updateMark`. Other methods would
 * throw if called, which is the point (a test that reaches them is exercising the wrong component).
 */
function fakeMarksClient(seed: MarkRecord[]): EvalUiClient {
  let marks = seed;
  return {
    listMarks: vi.fn(async (filter?: MarkListFilter) => ({
      marks: marks.filter((candidate) => (!filter?.status || candidate.status === filter.status) && (!filter?.kind || candidate.kind === filter.kind))
    })),
    getMark: vi.fn(async (id: string) => {
      const found = marks.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Mark not found: ${id}`);
      return found;
    }),
    updateMark: vi.fn(async (id: string, patch: MarkUpdatePatch) => {
      marks = marks.map((candidate) => (candidate.id === id ? { ...candidate, ...patch, links: { ...candidate.links, ...patch.links } } : candidate));
      const updated = marks.find((candidate) => candidate.id === id);
      if (!updated) throw new Error(`Mark not found: ${id}`);
      return updated;
    })
  } as unknown as EvalUiClient;
}

describe("MarksInbox", () => {
  it("renders observed text as the primary line and expected/hypothesis as secondary", async () => {
    const client = fakeMarksClient([mark()]);
    render(MarksInbox, { props: { client } });
    expect(await screen.findByText(/greped the codebase for six minutes/)).toBeInTheDocument();
    expect(screen.getByText(/should have read docs\/index\.md first/)).toBeInTheDocument();
    expect(screen.getByText(/CLAUDE\.md never points at docs\/index\.md/)).toBeInTheDocument();
  });

  it("shows a status chip, kind, repo, and age", async () => {
    const client = fakeMarksClient([mark({ status: "fixed", kind: "candidate" })]);
    const { container } = render(MarksInbox, { props: { client } });
    await screen.findByText(/greped the codebase/);
    expect(container.querySelector(".mark-status-fixed")).toHaveTextContent("fixed");
    expect(screen.getByText("candidate")).toBeInTheDocument();
    expect(screen.getByText("otto-tangent")).toBeInTheDocument();
  });

  it("shows an empty state when no marks match", async () => {
    const client = fakeMarksClient([]);
    render(MarksInbox, { props: { client } });
    expect(await screen.findByText("No marks match this filter.")).toBeInTheDocument();
  });

  it("dismissing a mark calls updateMark with status dismissed and updates the row", async () => {
    const client = fakeMarksClient([mark()]);
    render(MarksInbox, { props: { client } });
    await screen.findByText(/greped the codebase/);

    await screen.getByRole("button", { name: "Dismiss" }).click();
    await waitFor(() => expect(client.updateMark).toHaveBeenCalledWith("20260705T143012-you-should-have-read", { status: "dismissed" }));
    await waitFor(() => expect(document.querySelector(".mark-status-dismissed")).toBeInTheDocument());
  });

  it("marking fixed calls updateMark with status fixed", async () => {
    const client = fakeMarksClient([mark()]);
    render(MarksInbox, { props: { client } });
    await screen.findByText(/greped the codebase/);

    await screen.getByRole("button", { name: "Mark fixed" }).click();
    await waitFor(() => expect(client.updateMark).toHaveBeenCalledWith("20260705T143012-you-should-have-read", { status: "fixed" }));
  });

  it("the to-eval affordance shows the copyable CLI command, never creating an eval itself", async () => {
    const client = fakeMarksClient([mark()]);
    render(MarksInbox, { props: { client } });
    await screen.findByText(/greped the codebase/);

    await screen.getByRole("button", { name: "to-eval" }).click();
    expect(screen.getByText("tangent mark to-eval 20260705T143012-you-should-have-read")).toBeInTheDocument();
  });

  it("links out to the Usage app by URL, and shows the session id as copyable text", async () => {
    const client = fakeMarksClient([mark()]);
    render(MarksInbox, { props: { client } });
    await screen.findByText(/greped the codebase/);

    const link = screen.getByRole("link", { name: "Open in Usage" });
    expect(link).toHaveAttribute("href", "/usage");
    expect(screen.getByText("session-abc")).toBeInTheDocument();
  });

  it("filters by status via the status select", async () => {
    const client = fakeMarksClient([mark({ id: "a", status: "new" }), mark({ id: "b", status: "fixed" })]);
    render(MarksInbox, { props: { client } });
    await screen.findByText("2 marks");

    const [statusSelect] = screen.getAllByRole("combobox");
    await statusSelect.dispatchEvent(new Event("change"));
    (statusSelect as HTMLSelectElement).value = "fixed";
    await statusSelect.dispatchEvent(new Event("change"));

    await waitFor(() => expect(client.listMarks).toHaveBeenLastCalledWith({ status: "fixed", kind: undefined }));
  });
});
