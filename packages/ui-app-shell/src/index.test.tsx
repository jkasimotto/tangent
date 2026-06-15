import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TangentAppShell } from "./index.js";

describe("app shell", () => {
  it("renders product navigation", () => {
    render(<TangentAppShell nav={{ product: "eval", sections: [{ items: [{ id: "runs", label: "Runs", href: "/eval/runs" }] }] }}>Main</TangentAppShell>);
    expect(screen.getByText("eval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runs" })).toBeInTheDocument();
  });
});
