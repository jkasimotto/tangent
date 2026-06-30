import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverUiApps, discoverUiAppCandidates } from "../dist/cli/ui-discovery.js";

test("UI discovery skips missing optional apps and loads installed apps", async () => {
  const registrations = await discoverUiApps({
    repo: ".",
    scope: "repo",
    mode: "static",
    providers: [],
    sources: [],
    startDir: "/repo",
    listNodeModulesPackages: listUsageManifest,
    readPackageJson: readUsageManifest,
    resolveModule: resolveOnlyUsage,
    importModule: importUsageRegistration
  });

  assert.deepEqual(registrations.map((registration) => registration.app.id), ["usage"]);
  assert.equal(registrations[0].context.mode, "static");
});

test("UI discovery surfaces broken installed apps", async () => {
  await assert.rejects(
    discoverUiApps({
      requestedApp: "usage",
      repo: ".",
      scope: "repo",
      mode: "static",
      providers: [],
      sources: [],
      startDir: "/repo",
      listNodeModulesPackages: listUsageManifest,
      readPackageJson: readUsageManifest,
      resolveModule: resolveInstalledUsage,
      importModule: importBrokenUsage
    }),
    /Installed UI app 'usage' is broken: bad import/
  );
});

test("UI discovery errors on unknown requested apps", async () => {
  await assert.rejects(
    discoverUiApps({
      requestedApp: "missing",
      repo: ".",
      scope: "repo",
      mode: "static",
      providers: [],
      sources: []
    }),
    /Unknown UI app: missing/
  );
});

test("UI discovery ignores incomplete manifest metadata", async () => {
  const candidates = await discoverUiAppCandidates({
    startDir: "/repo",
    listNodeModulesPackages: listUsageManifest,
    readPackageJson: readIncompleteUsageManifest
  });

  assert.deepEqual(candidates, []);
});

test("manifest UI app candidates override fallback candidates", async () => {
  const candidates = await discoverUiAppCandidates({
    startDir: "/repo",
    listNodeModulesPackages: listUsageManifest,
    readPackageJson: readUsageManifest
  });

  assert.equal(candidates[0].id, "usage");
  assert.equal(candidates[0].label, "Usage Local");
  assert.equal(candidates[0].order, 5);
});

test("manifest discovery accepts workspace package symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-ui-discovery-"));
  try {
    const workspacePackage = path.join(root, "packages", "usage");
    const scopedModules = path.join(root, "node_modules", "@tangent");
    await mkdir(workspacePackage, { recursive: true });
    await mkdir(scopedModules, { recursive: true });
    await writeFile(path.join(workspacePackage, "package.json"), JSON.stringify(await readUsageManifest()), "utf8");
    await symlink(workspacePackage, path.join(scopedModules, "usage"), "dir");

    const candidates = await discoverUiAppCandidates({ startDir: root });

    assert.deepEqual(candidates.map((candidate) => candidate.id), ["usage"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Resolves only the Usage UI server fixture. */
async function resolveOnlyUsage(specifier) {
  return specifier === "@tangent/usage/server" ? "usage-server" : undefined;
}

/** Reads a Usage manifest fixture with incomplete UI app metadata. */
async function readIncompleteUsageManifest() {
  return {
    name: "@tangent/usage",
    tangent: {
      uiApp: {
        id: "usage",
        serverExport: "@tangent/usage/server",
        factory: "createUsageUiApp"
      }
    }
  };
}

/** Resolves Usage as an installed fixture. */
async function resolveInstalledUsage() {
  return "usage-server";
}

/** Imports a fake Usage registration factory. */
async function importUsageRegistration() {
  return {
    /** Creates a fake Usage UI registration. */
    async createUsageUiApp(context) {
      return {
        app: { id: "usage", label: "Usage", modulePath: "/apps/usage/embedded.js" },
        routes: [],
        assetMounts: [],
        context
      };
    }
  };
}

/** Throws like a broken installed Usage server module. */
async function importBrokenUsage() {
  throw new Error("bad import");
}

/** Lists one Usage package manifest fixture. */
async function listUsageManifest() {
  return ["/repo/node_modules/@tangent/usage/package.json"];
}

/** Reads a Usage package manifest fixture with UI metadata. */
async function readUsageManifest() {
  return {
    name: "@tangent/usage",
    tangent: {
      uiApp: {
        id: "usage",
        label: "Usage Local",
        serverExport: "@tangent/usage/server",
        factory: "createUsageUiApp",
        order: 5
      }
    }
  };
}
