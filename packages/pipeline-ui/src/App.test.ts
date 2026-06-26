import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App.svelte";
import { createMemoryPipelineClient, type MemoryPipelineSeed, type PipelineUiClient } from "./client.js";

afterEach(() => cleanup());

const SEED: MemoryPipelineSeed[] = [
  { slug: "older", title: "Older idea", status: "scoped", updatedAt: "2026-06-24T00:00:00.000Z", realProblem: "Older real problem.", proposedDesign: "Older design." },
  { slug: "newer", title: "Newer idea", status: "planned", updatedAt: "2026-06-26T00:00:00.000Z", realProblem: "The **newest** real problem.", proposedDesign: "The newest design." }
];

describe("designs app", () => {
  it("lists features newest-first and auto-selects the newest", async () => {
    render(App, { props: { client: createMemoryPipelineClient(SEED) } });

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Newer idea planned", "Older idea scoped"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Newer idea" })).toBeInTheDocument();
  });

  it("renders the Real problem block before the Proposed design block", async () => {
    render(App, { props: { client: createMemoryPipelineClient(SEED) } });

    await screen.findByRole("heading", { name: "Newer idea" });
    const real = screen.getByLabelText("Real problem");
    const proposed = screen.getByLabelText("Proposed design");
    expect(real.compareDocumentPosition(proposed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(real.querySelector(".prose")).toHaveTextContent("real problem");
    expect(real.querySelector("strong")).toHaveTextContent("newest");
  });

  it("selecting a feature loads its scope", async () => {
    render(App, { props: { client: createMemoryPipelineClient(SEED) } });

    await fireEvent.click(await screen.findByRole("button", { name: /Older idea/ }));

    expect(await screen.findByRole("heading", { name: "Older idea" })).toBeInTheDocument();
    expect(screen.getByLabelText("Real problem")).toHaveTextContent("Older real problem.");
  });

  it("shows the empty state when there are no features", async () => {
    render(App, { props: { client: createMemoryPipelineClient([]) } });

    expect(await screen.findByText("No designs yet")).toBeInTheDocument();
  });

  it("shows an inline retry banner when the list fetch fails", async () => {
    const failing: PipelineUiClient = {
      /** Always fails, to exercise the list-fetch error path. */
      loadFeatures: async () => { throw new Error("boom"); },
      /** Unused in this case; the list never loads. */
      loadScope: async () => { throw new Error("unused"); }
    };
    render(App, { props: { client: failing } });

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
