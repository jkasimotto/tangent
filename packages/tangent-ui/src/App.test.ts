import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, test } from "vitest";
import App from "./App.svelte";

import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

test("renders discovered apps as always-visible tabs and mounts the active app", async () => {
  const imports = installFetchAndImporter([{
    id: "usage",
    label: "Usage",
    routePath: "/usage",
    modulePath: "/apps/usage/embedded.js",
    stylePaths: ["/apps/usage/embedded.css"]
  }, {
    id: "trees",
    label: "Trees",
    routePath: "/trees",
    modulePath: "/apps/trees/embedded.js",
    stylePaths: ["/apps/trees/embedded.css"]
  }]);
  window.history.replaceState({}, "", "/usage");

  render(App);

  // Both apps are visible at once; the active one is highlighted, no dropdown to open.
  const usageTab = await screen.findByRole("button", { name: "Usage" });
  const treesTab = screen.getByRole("button", { name: "Trees" });
  expect(usageTab).toHaveClass("active");
  expect(usageTab).toHaveAttribute("aria-current", "page");
  expect(treesTab).not.toHaveClass("active");
  expect(usageTab.closest(".shell-chrome")).toBeInTheDocument();
  const mountedUsage = await screen.findByText("Mounted usage");
  expect(mountedUsage.closest(".shell-workspace")).toBeInTheDocument();
  await fireEvent.click(treesTab);
  await waitFor(() => expect(screen.getByText("Mounted trees")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Trees" })).toHaveClass("active");
  expect(imports()).toEqual(["/apps/usage/embedded.js", "/apps/trees/embedded.js"]);
  expect(document.head.querySelector('link[href="/apps/usage/embedded.css"]')).toBeInTheDocument();
  expect(document.head.querySelector('link[href="/apps/trees/embedded.css"]')).toBeInTheDocument();
});

test("resolves an app sub-path like /usage/insights to the owning app and keeps the URL", async () => {
  installFetchAndImporter([{
    id: "usage",
    label: "Usage",
    routePath: "/usage",
    modulePath: "/apps/usage/embedded.js"
  }, {
    id: "trees",
    label: "Trees",
    routePath: "/trees",
    modulePath: "/apps/trees/embedded.js"
  }]);
  window.history.replaceState({}, "", "/usage/insights");

  render(App);

  // The deep link mounts the usage app and the sub-path is preserved for the app to route on.
  await screen.findByText("Mounted usage");
  expect(screen.getByRole("button", { name: "Usage" })).toHaveClass("active");
  expect(window.location.pathname).toBe("/usage/insights");
});

/** Installs mocked app discovery and dynamic imports for shell tests. */
function installFetchAndImporter(apps: unknown[]): () => string[] {
  const imported: string[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ apps }), {
    headers: { "content-type": "application/json" }
  });
  Object.assign(globalThis, {
    __vitePreload: undefined
  });
  const originalImport = globalThis.__dynamicImportForTest;
  globalThis.__dynamicImportForTest = async (path: string) => {
    imported.push(path);
    return {
      /** Mounts a fake embedded app into the provided target. */
      mountApp(target: HTMLElement, context: { appId: string }) {
        target.textContent = `Mounted ${context.appId}`;
        return () => {
          target.textContent = "";
        };
      }
    };
  };
  return () => {
    globalThis.__dynamicImportForTest = originalImport;
    return imported;
  };
}
