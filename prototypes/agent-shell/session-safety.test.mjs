import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("background Goal reconciliation cannot stop an agent session", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const reconcile = source.match(/async function reconcileGoals\(sessions\) \{[\s\S]*?\n\}\n\nconst goalInfoCache/)?.[0] ?? "";
  assert.match(reconcile, /preserved session/);
  assert.doesNotMatch(reconcile, /kill-session|cascadeGoalDone/);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/kill\/"\)/);
  assert.match(source, /"kill-session", "-t", "=" \+ name/);
});
