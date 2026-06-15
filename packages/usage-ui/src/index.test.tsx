import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UsageApp } from "./app/UsageApp.js";

describe("usage ui", () => {
  it("renders session surface", () => {
    render(<UsageApp />);
    expect(screen.getByText("Usage sessions")).toBeInTheDocument();
  });
});
