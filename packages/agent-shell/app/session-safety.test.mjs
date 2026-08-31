import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("background Goal reconciliation stops only exact closed-Goal workers", async () => {
  const [source, controls] = await Promise.all([
    readFile(path.join(here, "server.mjs"), "utf8"),
    readFile(path.join(here, "shell-control-routes.mjs"), "utf8"),
  ]);
  const reconcile = source.match(/async function reconcileGoals\([^\n]*\) \{[\s\S]*?\n\}\n\nconst goalInfoCache/)?.[0] ?? "";
  const cleanup = source.match(/async function finishGoalExecutions\([^\n]*\) \{[\s\S]*?\n\}\n\n\/\*\* Marks one Goal/)?.[0] ?? "";
  assert.match(reconcile, /finishGoalExecutions/);
  assert.doesNotMatch(reconcile, /kill-session|cascadeGoalDone/);
  assert.match(cleanup, /observed = await listAllSessions\(\{ fresh: true \}\)/);
  assert.doesNotMatch(cleanup, /observed = sessions \?\?/);
  assert.match(cleanup, /live\.kind !== "goal" \|\| !targets\.has\(live\.goal\)/);
  assert.match(cleanup, /terminateOwnedSession\(name\)/);
  assert.match(controls, /url\.pathname\.startsWith\("\/api\/kill\/"\)/);
  assert.doesNotMatch(source, /"kill-session"/);
});

test("the pane observer owns context parsing and session enrichment", async () => {
  const source = await readFile(path.join(here, "pane-observer.mjs"), "utf8");
  assert.match(source, /parseContextFill\(text\)/);
  assert.match(source, /context: observed\.context \?\? null/);
  assert.match(source, /context: null/);
});

test("workers have no self-replacement implementation", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.doesNotMatch(source, /continueWorkerSession|continueWorker:/);
});

test("the server keeps its shared session activation primitives", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(source, /const sleep = \(ms\) => new Promise\(\(resolve\) => setTimeout\(resolve, ms\)\)/);
  assert.match(source, /async function typeInto\(session, text, submit\)/);
  assert.match(source, /for \(const chunk of typeChunks\(text\)\)/);
  assert.match(source, /async function spawnBrainSession[\s\S]*?await sleep\(700\)/);
  assert.match(source, /async function spawnBrainSession[\s\S]*?await typeInto\(name,/);
});

test("the server refuses every Tangent mutation from a worker session through one gate", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(source, /const refusal = await refuseWorkerMutation\(req, url\)/);
  assert.equal(source.match(/workers only send\. Use the exact Area-path command in the worker prompt\./g)?.length, 1, "one literal, one gate");
  const gated = source.match(/const WORKER_REFUSED_ROUTES = new Set\(\[[\s\S]*?\]\)/)?.[0] ?? "";
  for (const route of ["/api/goals/edit", "/api/goals/create", "/api/goals/own", "/api/goals/release", "/api/goals/start", "/api/pipelines/append", "/api/areas/new", "/api/areas/status", "/api/document/resolve", "/api/brains/start", "/api/brains/requests"]) {
    assert.ok(gated.includes(`"${route}"`), `${route} is gated`);
  }
  for (const route of ["/api/goals/handover", "/api/agents/send", "/api/goals/show"]) {
    assert.ok(!gated.includes(`"${route}"`), `${route} stays open`);
  }
});

test("an exact Job Goal path bypasses the vault-wide Goal scan", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const resolver = source.match(/async function jobGoal\(requested\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(resolver, /const exact = await readExactGoal\(requested\)/);
  assert.ok(resolver.indexOf("readExactGoal(requested)") < resolver.indexOf("goalsByFile()"));
});

test("the package starts the single-owner gateway and keeps terminal transport out of the controller", async () => {
  const [manifestText, gateway, controller] = await Promise.all([
    readFile(path.join(here, "..", "package.json"), "utf8"),
    readFile(path.join(here, "gateway.mjs"), "utf8"),
    readFile(path.join(here, "server.mjs"), "utf8"),
  ]);
  assert.equal(JSON.parse(manifestText).scripts.start, "node app/gateway.mjs");
  assert.match(gateway, /attachTerminalTransport\(server/);
  assert.match(gateway, /TANGENT_CONTROLLER_HEARTBEAT_TIMEOUT_MS/);
  assert.match(controller, /if \(!IS_CONTROLLER\) \{\s*attachTerminalTransport/);
});

test("an explicit rebuild replaces the asset-owning gateway", async () => {
  const [gateway, controller, worker, cli] = await Promise.all([
    readFile(path.join(here, "gateway.mjs"), "utf8"),
    readFile(path.join(here, "server.mjs"), "utf8"),
    readFile(path.join(here, "rebuild-worker.mjs"), "utf8"),
    readFile(path.join(here, "..", "src", "cli", "commands", "shell.ts"), "utf8"),
  ]);
  assert.match(gateway, /AGENT_SHELL_GATEWAY_BOOT: GATEWAY_BOOT_ID/);
  assert.match(gateway, /AGENT_SHELL_GATEWAY_PID: String\(process\.pid\)/);
  assert.match(controller, /bootId: RUNTIME_BOOT_ID/);
  assert.match(controller, /serverPid: RUNTIME_SERVER_PID/);
  assert.match(worker, /process\.kill\(Number\(serverPidText\), "SIGUSR2"\)/);
  assert.match(gateway, /shutdown\("SIGUSR2", 75\)/);
  assert.match(cli, /runtime\?\.gateway\?\.boot \?\? sessions\.boot/);
});

test("every real-tmux integration test selects a private socket", async () => {
  const files = (await readdir(here)).filter((file) => file.endsWith(".test.mjs"));
  const missing = [];
  for (const file of files) {
    if (file === path.basename(fileURLToPath(import.meta.url))) continue;
    const source = await readFile(path.join(here, file), "utf8");
    const invokesTmux = /execFile(?:Async)?\("tmux"|execFile\("tmux"/.test(source);
    const startsController = /spawn\([^\n]*\["server\.mjs"\]/.test(source);
    const usesServerFixture = /startShellServer/.test(source);
    if ((invokesTmux || startsController || usesServerFixture) && !/isolateTmuxTests\(\)/.test(source)) missing.push(file);
  }
  assert.deepEqual(missing, []);
});

test("a transport restart reconnects the terminal and only a missing tmux session ends it", async () => {
  const [browser, transport] = await Promise.all([
    readFile(path.join(here, "public", "terminal-controller.js"), "utf8"),
    readFile(path.join(here, "terminal-transport.mjs"), "utf8"),
  ]);
  assert.match(browser, /event\.code === 4404/);
  assert.match(browser, /window\.setTimeout\(connectWhenMeasured, delay\)/);
  assert.doesNotMatch(browser, /onclose = \(\) => terminal\?\.write\([^\n]*session ended/);
  assert.match(transport, /socket\.close\(4404, "tmux session ended"\)/);
  assert.match(transport, /socket\.bufferedAmount > MAX_TERMINAL_BUFFER_BYTES/);
});

test("the outer launcher verifies health and encodes throttled unsuccessful-exit recovery", async () => {
  const [native, template] = await Promise.all([
    readFile(path.join(here, "native", "main.swift"), "utf8"),
    readFile(path.join(here, "native", "com.tangent.agent-shell.plist.template"), "utf8"),
  ]);
  assert.match(native, /\/api\/health/);
  assert.match(native, /launchctl/);
  assert.match(native, /serverRestartAttempt/);
  assert.match(template, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(template, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  assert.match(template, /gateway\.mjs/);
  assert.doesNotMatch(template, /server\.mjs/);
});
