import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import type { EvalDiffLineView, EvalDiffView } from "./client.js";
import { fakeEvalClient } from "./test-support.js";

afterEach(() => cleanup());

describe("eval svelte app", () => {
  it("renders the selected run and each config's flame caption", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });

    expect(await screen.findByText(/ui-compare/)).toBeInTheDocument();
    await screen.findByLabelText("Configs compared");
    // Each config's metrics surface as a flame caption (duration / tokens / peak context).
    expect(container.querySelector(".flame-caption")).toBeInTheDocument();
  });

  it("opens on the aligned Compare view with two pickers and three sections", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");

    // Two config pickers, A and B, in the header.
    expect(container.querySelectorAll(".compare-head select")).toHaveLength(2);
    // Aligned sections, in order, with Conversations and Scoring under Changed files.
    const titles = Array.from(container.querySelectorAll(".aligned-section h3")).map((n) => n.textContent?.trim());
    expect(titles).toEqual(["Prompts", "Context files", "Changed files", "Conversations", "Scoring"]);
    // No legacy mode tabs.
    expect(screen.queryByRole("button", { name: "Individual" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Side by side" })).toBeNull();
  });

  it("dims identical rows and marks differing ones", async () => {
    const client = fakeEvalClient({
      artifacts: [
        { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
        { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: false }
      ]
    });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");
    const rows = container.querySelectorAll(".aligned-row");
    // Prompt row identical -> dimmed; code row differs -> not dimmed.
    expect(container.querySelector(".aligned-section .aligned-row.identical")).toBeInTheDocument();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("prefetches changed code diffs so opening a changed file needs no fetch on click", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    // The changed code file's diff is fetched for both sides as soon as the comparison loads, with no click.
    await vi.waitFor(() => expect((client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2));
    const beforeClick = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length;
    // Opening it serves from the prefetch cache: no new fetch, content is already there.
    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    expect((await screen.findAllByText("Use repo context.")).length).toBe(2);
    expect((client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(beforeClick);
  });

  it("expands a changed file on both sides with one click and caches the fetch", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // One click on either column's label opens both columns; each side is fetched once.
    const expandButtons = await screen.findAllByRole("button", { name: "Expand src/foo.ts" });
    expect(expandButtons.length).toBe(2);
    await fireEvent.click(expandButtons[0]);
    expect((await screen.findAllByText("Use repo context.")).length).toBe(2);
    const callsAfterFirst = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(2);

    // Collapse and re-expand: no new fetch (both sides served from cache).
    await fireEvent.click(screen.getAllByRole("button", { name: "Collapse src/foo.ts" })[0]);
    await fireEvent.click(screen.getAllByRole("button", { name: "Expand src/foo.ts" })[0]);
    expect((client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it("collapses unchanged code in the aligned view so the agent's edit is the focus", async () => {
    const equalBefore: EvalDiffLineView[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "equal" as const, leftNumber: i + 1, rightNumber: i + 1, left: `line ${i + 1}`, right: `line ${i + 1}`
    }));
    const addedLine: EvalDiffLineView = { kind: "add", rightNumber: 41, right: "added feature line" };
    const equalAfter: EvalDiffLineView[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "equal" as const, leftNumber: i + 41, rightNumber: i + 42, left: `line ${i + 41}`, right: `line ${i + 42}`
    }));
    const codeDiff: EvalDiffView = {
      artifact: { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true },
      left: { variantId: "empty", label: "task/empty" },
      right: { variantId: "repo", label: "task/repo" },
      lines: [...equalBefore, addedLine, ...equalAfter]
    };
    const client = fakeEvalClient({ codeDiff });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // One click opens both columns; the added line shows on each side.
    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    expect((await screen.findAllByText("added feature line")).length).toBe(2);
    // Equal runs were collapsed into gap placeholders.
    expect(container.querySelectorAll(".diff-gap").length).toBeGreaterThanOrEqual(1);
    // Each side collapses its 80 equal lines: far fewer rendered rows in a single detail.
    const oneDetail = container.querySelector(".aligned-detail") as HTMLElement;
    expect(oneDetail.querySelectorAll(".review-row").length).toBeLessThan(80);
  });

  it("adds an inline comment by clicking a diff line in the left column", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // Expand the file (loads both columns). Only this file is expanded, so each side shows one commentable
    // line: index 0 is the left column (the "empty" variant), index 1 the right.
    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    await fireEvent.click((await screen.findAllByRole("button", { name: "Comment on line 1" }))[0]);
    await fireEvent.input(screen.getByPlaceholderText(/comment on this line/), { target: { value: "bad guard" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add note flagging an issue" }));

    const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
    expect(saved.variants["task/empty"].notes.at(-1).text).toBe("bad guard");
    expect(saved.variants["task/empty"].notes.at(-1).sentiment).toBe("bad");
  });

  it("saves a positive inline comment against the clicked column's variant and shows it inline", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click((await screen.findAllByRole("button", { name: "Expand src/foo.ts" }))[0]);
    // Index 1 is the right column (the "repo" variant).
    await fireEvent.click((await screen.findAllByRole("button", { name: "Comment on line 1" }))[1]);
    await fireEvent.input(screen.getByPlaceholderText(/comment on this line/), { target: { value: "nice fix" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add positive note" }));

    expect(await screen.findByText("nice fix")).toBeInTheDocument();
    const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
    expect(saved.variants["task/repo"].notes.at(-1).sentiment).toBe("good");
    expect(saved.variants["task/empty"]).toBeUndefined();
  });

  it.todo("collapses unchanged code in Individual review so the agent's edit is the focus");

  it("renders +N -M counts on the side that changed a file", async () => {
    const client = fakeEvalClient({
      artifacts: [
        {
          id: "code:src/foo.ts",
          kind: "code",
          path: "src/foo.ts",
          label: "src/foo.ts",
          status: "changed",
          changedLeft: true,
          changedRight: true,
          addedLeft: 5,
          removedLeft: 2,
          addedRight: 3,
          removedRight: 1
        }
      ]
    });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");

    // Left side (aligned-a) shows its counts.
    const sideA = container.querySelector(".aligned-a") as HTMLElement;
    expect(within(sideA).getByText("+5 -2")).toBeInTheDocument();

    // Right side (aligned-b) shows its counts.
    const sideB = container.querySelector(".aligned-b") as HTMLElement;
    expect(within(sideB).getByText("+3 -1")).toBeInTheDocument();
  });

  it("launches a run from the selected spec", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });

    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(client.launchRun).toHaveBeenCalledWith({ specPath: "/evals/compare.json" });
  });

  it("notes-only collapses to annotated files with their notes", async () => {
    const client = fakeEvalClient();
    client.getReviews = async () => ({
      schema: "eval.reviews.v1",
      variants: { "task/empty": { notes: [{ id: "n1", artifactId: "code:src/foo.ts", artifactLabel: "src/foo.ts", line: 2, snippet: "return 1", sentiment: "bad", text: "wrong base case", ts: 1 }] } }
    });
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    await fireEvent.click(await screen.findByRole("button", { name: "Notes only" }));
    expect(screen.getByText("wrong base case")).toBeInTheDocument();
    // The prompt row (no notes) is gone in notes-only.
    expect(screen.queryByText("Task prompt")).toBeNull();
  });

  it("switches the Context section to the Assembled view and renders verbatim blocks per side", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    // Repo side shows the CLAUDE.md content; empty side shows the empty state.
    expect(await screen.findByText("root rules")).toBeInTheDocument();
    expect(screen.getByText("No repo context loads at this path.")).toBeInTheDocument();
  });

  it("marks a context block present on only one side", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    // The repo side's CLAUDE.md is absent from the empty side, so its divider is tagged "only here".
    expect(screen.getAllByText("only here").length).toBeGreaterThanOrEqual(1);
  });

  it("re-assembles both sides when the cwd changes", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    const calls = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length;
    await fireEvent.input(screen.getByLabelText("cwd path"), { target: { value: "client/lib" } });
    // The reload is debounced, so it arrives a beat after the keystroke, then re-assembles both sides.
    await vi.waitFor(() => {
      const last = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(last?.cwd).toBe("client/lib");
    });
    expect((client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls);
  });

  it("loads a skill body when its picker checkbox is toggled", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(await screen.findByRole("checkbox", { name: "testing" }));
    expect(await screen.findByText("FULL TESTING BODY")).toBeInTheDocument();
  });

  it("copies a side's verbatim concatenation without provenance dividers", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(await screen.findByRole("button", { name: "Copy repo context" }));
    expect(writeText).toHaveBeenCalledWith("root rules\n\ntesting: Use when testing");
  });

  it("prefetches assembled context so opening the Assembled view needs no fetch", async () => {
    const client = fakeEvalClient();
    const assembleContext = client.assembleContext as ReturnType<typeof vi.fn>;
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    // Assembled context is fetched for both sides on load, before the Assembled view is ever opened.
    await vi.waitFor(() => expect(assembleContext.mock.calls.length).toBeGreaterThanOrEqual(2));
    const before = assembleContext.mock.calls.length;
    await fireEvent.click(await screen.findByRole("button", { name: "Assembled" }));
    expect(await screen.findByText("root rules")).toBeInTheDocument();
    expect(assembleContext.mock.calls.length).toBe(before);
  });

  it("fails gracefully when a selected run cannot be loaded, never sticking on Loading", async () => {
    const client = fakeEvalClient({ missingRunId: "gone" });
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    // Switch to a run whose getRun rejects (deleted or corrupt). The run picker is the first select.
    const runSelect = container.querySelector("select") as HTMLSelectElement;
    await fireEvent.change(runSelect, { target: { value: "gone" } });

    // A clear, recoverable message replaces the comparison: no endless "Loading run…".
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/Loading run/)).toBeNull();
  });

  it("shows a recoverable error instead of a stuck 'Loading comparison' when the comparison fails to load", async () => {
    // The server rejecting a variant pair (e.g. a stale pair mid-switch) must never read as an endless
    // "Loading comparison": the compare area shows the error and a Reload affordance the user can act on.
    const client = fakeEvalClient();
    client.compareRun = vi.fn(async () => {
      throw new Error("Variant pair not found for case debug-log.");
    });
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);

    expect(await screen.findByText(/comparison could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/Variant pair not found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload run" })).toBeInTheDocument();
    // The fake loading state is gone, and the run picker stays usable so the user can switch away.
    expect(screen.queryByText("Loading comparison")).toBeNull();
    expect((document.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
  });

  it("never fetches context for the new run with the previous run's variant ids when switching runs", async () => {
    // Two runs share the case id "task" but have different variant ids. Switching between them must not carry
    // the old run's variant selection onto the new run id, which the server answers with a 404.
    const client = fakeEvalClient({ secondRunId: "run2" });
    const getContextManifest = client.getContextManifest as ReturnType<typeof vi.fn>;
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await screen.findByLabelText("Configs compared");

    // Switch to the second run. The run picker is the first select.
    const runSelect = container.querySelector("select") as HTMLSelectElement;
    await fireEvent.change(runSelect, { target: { value: "run2" } });

    // The new run's manifest is eventually fetched with its own (alt-) variants.
    await vi.waitFor(() =>
      expect(getContextManifest.mock.calls.some((call) => call[0].runId === "run2" && call[0].variant.startsWith("alt-"))).toBe(true)
    );
    // No manifest fetch ever pairs the new run id with the previous run's variant ids (the 404 path).
    const stale = getContextManifest.mock.calls.filter((call) => call[0].runId === "run2" && !call[0].variant.startsWith("alt-"));
    expect(stale).toEqual([]);
  });

  it("prefetches conversations when the Conversations header is hovered, before it is opened", async () => {
    const client = fakeEvalClient();
    const getConversations = client.getConversations as ReturnType<typeof vi.fn>;
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    const header = await screen.findByRole("button", { name: /Conversations/ });
    expect(getConversations.mock.calls.length).toBe(0);
    await fireEvent.pointerEnter(header);
    await vi.waitFor(() => expect(getConversations.mock.calls.length).toBe(2));
  });
});
