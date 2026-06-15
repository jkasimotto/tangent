import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RollupApp } from "./app/RollupApp.js";

describe("rollup ui", () => {
  it("renders builder trade-off stats", () => {
    render(<RollupApp />);
    expect(screen.getByText("Rollup builder")).toBeInTheDocument();
    expect(screen.getByText("Tokens excluded")).toBeInTheDocument();
  });
});
