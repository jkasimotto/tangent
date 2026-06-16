import "./test-setup.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TangentAppShell } from "./index.js";

describe("app shell", () => {
  it("renders product navigation", () => {
    render(<TangentAppShell nav={{ product: "eval", sections: [{ items: [{ id: "runs", label: "Runs", href: "/eval/runs" }] }] }}>Main</TangentAppShell>);
    expect(screen.getByText("eval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runs" })).toBeInTheDocument();
  });

  it("supports in-app navigation without replacing accessible links", async () => {
    const navigated: string[] = [];
    render(
      <TangentAppShell
        nav={{ product: "usage", sections: [{ items: [{ id: "timeline", label: "Timeline", href: "/usage/timeline" }] }] }}
        activeItemId="timeline"
        onNavigate={(item) => navigated.push(item.id)}
      >
        Main
      </TangentAppShell>
    );

    const link = screen.getByRole("link", { name: "Timeline", current: "page" });
    expect(link).toHaveAttribute("href", "/usage/timeline");
    fireEvent.click(link);
    expect(navigated).toEqual(["timeline"]);
  });
});
