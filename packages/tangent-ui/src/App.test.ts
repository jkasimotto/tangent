import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { expect, test } from "vitest";
import App from "./App.svelte";

import "@testing-library/jest-dom/vitest";

test("renders discovered apps and mounts the active app", async () => {
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

  const switcher = await screen.findByRole("button", { name: "Switch Tangent app" });
  expect(switcher).toHaveTextContent("Usage");
  expect(switcher.closest(".shell-chrome")).toBeInTheDocument();
  const mountedUsage = await screen.findByText("Mounted usage");
  expect(mountedUsage.closest(".shell-workspace")).toBeInTheDocument();
  await fireEvent.click(switcher);
  expect(screen.getByRole("button", { name: "Usage" })).toHaveClass("active");
  await fireEvent.click(screen.getByRole("button", { name: "Trees" }));
  await waitFor(() => expect(screen.getByText("Mounted trees")).toBeInTheDocument());
  expect(imports()).toEqual(["/apps/usage/embedded.js", "/apps/trees/embedded.js"]);
  expect(document.head.querySelector('link[href="/apps/usage/embedded.css"]')).toBeInTheDocument();
  expect(document.head.querySelector('link[href="/apps/trees/embedded.css"]')).toBeInTheDocument();
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
