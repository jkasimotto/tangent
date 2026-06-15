import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscriptMessage } from "./index.js";

describe("transcript renderer", () => {
  it("renders role and preview text", () => {
    render(<TranscriptMessage role="assistant" textPreview="Done" />);
    expect(screen.getByText("assistant")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});
