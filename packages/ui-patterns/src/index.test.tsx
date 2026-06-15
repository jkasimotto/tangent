import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MasterDetailLayout, ProgressiveMetadata } from "./index.js";

describe("ui patterns", () => {
  it("renders master detail regions", () => {
    render(<MasterDetailLayout list="Sessions" detail="Overview" inspector="Evidence" />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
  });

  it("keeps metadata behind disclosure", () => {
    render(<ProgressiveMetadata>raw</ProgressiveMetadata>);
    expect(screen.getByRole("button", { name: "Raw metadata" })).toBeInTheDocument();
  });
});
