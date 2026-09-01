import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/core";
import type { GovernanceFinding } from "./index.js";

/** Keeps Work on its direct gateway store and away from retired large projections. */
export async function lintWorkReadModelBoundary(root: string): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const largeOwners = /\b(?:vaultIndex|projectDesk|pipelinesView|brainsView|programsSnapshot|projectMaterialOperationEvents|processViews|projectWorkVault)\b/;
  const workModules = [
    "packages/agent-shell/app/work-source-adapters.mjs",
    "packages/agent-shell/app/work-publisher.mjs",
    "packages/agent-shell/app/work-store.mjs",
    "packages/agent-shell/app/public/work-client.js",
    "packages/agent-shell/app/public/work-v3-view.js",
  ];
  for (const rel of workModules) {
    const file = path.join(root, rel);
    if (!await pathExists(file)) continue;
    const source = await readFile(file, "utf8");
    const forbidden = largeOwners.test(source) || /agent-shell-work\.v[12]|compatibility\.v1|workOperations\.merge/.test(source)
      || (rel.includes("/public/") && /\/api\/(?:vault|sessions)\b/.test(source));
    if (!forbidden) continue;
    findings.push({
      rule: "agent-shell/work-read-boundary", severity: "error", file: rel,
      message: "Work reads a retired projection owner or compatibility path.",
      fix: ["Read exact Work sources in work-source-adapters.mjs.", "Keep browser Work reads on /api/work v3 only."],
    });
  }
  const gatewayFile = path.join(root, "packages/agent-shell/app/gateway.mjs");
  if (await pathExists(gatewayFile)) {
    const source = await readFile(gatewayFile, "utf8");
    const workRoute = source.indexOf('url.pathname === "/api/work"');
    const proxyRoute = source.indexOf('url.pathname.startsWith("/api/")');
    if (workRoute < 0 || proxyRoute < 0 || workRoute > proxyRoute) findings.push({
      rule: "agent-shell/work-read-boundary", severity: "error", file: "packages/agent-shell/app/gateway.mjs",
      message: "The direct Work route is missing or runs after controller proxy routing.",
      fix: ["Serve GET /api/work from the validated gateway Work store before the general /api proxy branch."],
    });
  }
  return findings;
}
