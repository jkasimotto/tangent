import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, EmptyState } from "./index.js";

describe("ui primitives", () => {
  it("renders buttons with accessible names", () => {
    render(<Button variant="primary">Open transcript</Button>);
    expect(screen.getByRole("button", { name: "Open transcript" })).toBeInTheDocument();
  });

  it("renders empty states as ordinary content", () => {
    render(<EmptyState title="No runs">Create a run first.</EmptyState>);
    expect(screen.getByText("No runs")).toBeInTheDocument();
    expect(screen.getByText("Create a run first.")).toBeInTheDocument();
  });
});
