import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunPage } from "./pages/RunPage.js";

describe("eval ui", () => {
  it("renders a run matrix", () => {
    render(<RunPage run={{ run: { id: "r1", name: "Run", createdAt: "", variants: [{ status: "done" }] }, metrics: [], cases: [{ caseId: "c1", variants: [] }] }} />);
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Cases")).toBeInTheDocument();
  });
});
