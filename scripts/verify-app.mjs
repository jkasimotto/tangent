#!/usr/bin/env node
// Boots a Tangent web app (usage|eval) read-only so an agent can drive the real app, against the
// user's live data, and verify its change. TANGENT_VERIFY_READONLY makes both apps non-writing:
//   eval  -> blocks the "launch run" button (spawns real agents / spends tokens).
//   usage -> disables the transcript watcher (its only writer; it rebuilds the multi-GB index).
// Everything else is GET/read, so live data is never modified. No copy, no clone, instant boot.
// Run in the background, read the printed { url } from stdout, drive the browser, then kill this process.
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default target is the combined `tangent ui` (usage + trees + eval mounted together); usage|eval boot a
// single app in isolation. The read-only flag covers all three: eval blocks launch, usage drops its watcher,
// trees rejects every mutation (create/delete entity).
const app = process.argv[2] || "ui";
if (!["ui", "usage", "eval"].includes(app)) {
  console.error("usage: node scripts/verify-app.mjs [ui|usage|eval]  (default: ui)");
  process.exit(2);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// For ui, run the root CLI directly; for a single app, resolve its .bin symlink to the real path (the CLI's
// isMain check compares import.meta.url (realpath) to argv[1], so launching via the symlink would silently no-op).
const entry = app === "ui"
  ? path.join(repoRoot, "dist", "cli", "index.js")
  : realpathSync(path.join(repoRoot, "node_modules", ".bin", `tangent-${app}`));
const workdir = mkdtempSync(path.join(tmpdir(), "tangent-verify-"));

// usage defaults to a Vite dev server; --static-ui serves prebuilt assets (faster, no hot reload needed).
const uiArgs = ["ui", "--port", "0", "--no-browser", "--json", ...(app === "usage" ? ["--static-ui"] : [])];
const log = createWriteStream(path.join(workdir, "server.log"));
const child = spawn(process.execPath, [entry, ...uiArgs], {
  cwd: repoRoot,
  env: { ...process.env, TANGENT_VERIFY_READONLY: "1" }
});

// ponytail: server.log dir auto-removed on exit; no separate stop command.
let cleaned = false;
/** Stops the app server and removes the temp log dir, guarded so signals and child-exit run it once. */
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  child.kill("SIGTERM");
  rmSync(workdir, { recursive: true, force: true });
}
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
child.on("exit", (code) => { cleanup(); process.exit(code ?? 0); });

// The app prints a JSON object ({ url, ... }) then blocks. Accumulate stdout until it parses, then report.
let buf = "";
let reported = false;
child.stdout.on("data", (chunk) => {
  log.write(chunk);
  if (reported) return;
  buf += chunk.toString();
  try {
    const info = JSON.parse(buf.trim());
    if (info.url) {
      reported = true;
      console.log(JSON.stringify({ url: info.url, log: path.join(workdir, "server.log") }));
    }
  } catch {
    // keep buffering until the full JSON object has arrived
  }
});
child.stderr.on("data", (chunk) => log.write(chunk));
