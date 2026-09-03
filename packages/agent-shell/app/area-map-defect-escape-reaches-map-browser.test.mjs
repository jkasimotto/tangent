import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

// The audit defect this suite closes: "Escape does nothing on the Map: Help, Outline and the
// Resources panel cannot be closed with the keyboard".
//
// The Map's own Escape order is correct; the key never reached it. The shell's document capture
// keydown listener claimed Escape whenever the Map owned focus, called preventDefault and
// stopPropagation, and ran `closeAreaMap()`, which does nothing while the Map is home. The Map host
// listener sits below document in the capture order, so it never saw the key. That is only visible
// with the real shell page around the Map, so this suite drives the unmodified production server
// against a temporary vault, exactly as the Map resource server proof does, rather than a static
// fixture that mounts the Map alone.
//
// Every assertion samples the surfaces on each animation frame after the press, so a surface that
// closes late is told apart from one that never closes at all.

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const SAMPLED_FRAMES = 40;
if (enabled) isolateTmuxTests();

/** Reserves and releases one non-live loopback port. */
async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

/** Prefers the PATH Node whose ABI matches installed native modules. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Runs one Git command inside the fixture vault. */
async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

/** Creates a temporary vault with one parent Area and one child Area. */
async function createFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "map-escape-browser-")));
  const trees = path.join(root, "trees");
  for (const area of ["otto", "otto/tangent"]) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nEscape fixture Area.\n`, "utf8");
  }
  await git(trees, "init", "--quiet");
  await git(trees, "config", "user.email", "escape-test@tangent.local");
  await git(trees, "config", "user.name", "Escape Test");
  await git(trees, "add", ".");
  await git(trees, "commit", "--quiet", "-m", "add: escape fixture");
  return { root, trees };
}

/** Waits until the isolated production server answers, or reports its early exit. */
async function waitForServer(base, child, output, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Agent Shell exited before readiness: ${output.join("")}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* startup can race the first connection */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Agent Shell did not start: ${output.join("")}`);
}

/** Stops the isolated server, escalating only to its exact child when needed. */
async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGKILL");
    await once(server.child, "exit");
  }
}

/** Starts the unmodified production server against only the temporary fixture roots. */
async function startServer(fixture) {
  const port = await freePort();
  assert.notEqual(port, 4321, "the fixture never binds the live Agent Shell port");
  const output = [];
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      HOME: fixture.root,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: fixture.trees,
      WORKSPACE: path.join(fixture.root, "workspace"),
      TANGENT_LOOPS_ROOT: path.join(fixture.root, "loops"),
      TANGENT_PIPELINES_ROOT: path.join(fixture.root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(fixture.root, "brains"),
      TANGENT_SESSION_OWNERS_ROOT: path.join(fixture.root, "session-owners"),
      TANGENT_CONTINUATIONS_ROOT: path.join(fixture.root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(fixture.root, "goal-cleanups"),
      TANGENT_ARMED_ROOT: path.join(fixture.root, "armed"),
      TANGENT_MAP_STATE_ROOT: path.join(fixture.root, "map-state"),
      TANGENT_PRESENTATIONS_ROOT: path.join(fixture.root, "presented"),
      TANGENT_HARNESS_LOG_ROOT: path.join(fixture.root, "harness-logs"),
      AGENT_MESSAGE_LOG: path.join(fixture.root, "messages.jsonl"),
      AGENT_SHELL_ACTION_LOG: path.join(fixture.root, "actions.jsonl"),
      AGENT_SHELL_REBUILD_STATE: path.join(fixture.root, "rebuild.json"),
      AGENT_SHELL_REBUILD_LOG: path.join(fixture.root, "rebuild.log"),
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_AREA_MAP_WORLD: "1",
      TANGENT_SHELL_INSTANCE_ID: `map-escape-browser-${process.pid}`,
      CHAT_SESSION: `map-escape-browser-${process.pid}`,
      GROQ_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, child, output);
  return { base, child, output };
}

/** Everything a person can tell about the Map controls, read in one pass. */
async function controls(page) {
  return page.evaluate(() => ({
    help: document.querySelectorAll(".tangent-map-help").length,
    outline: document.querySelectorAll(".tangent-map-outline.visible").length,
    panel: document.querySelectorAll(".tangent-map-resources").length,
    map: document.querySelectorAll("[data-tangent-area-map]").length,
    active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? "",
  }));
}

/** Presses one key and reads the controls on every animation frame after it, so a late close is still a close. */
async function pressAndSample(page, key) {
  await page.keyboard.press(key);
  const samples = [];
  for (let frame = 0; frame < SAMPLED_FRAMES; frame += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    samples.push(await controls(page));
  }
  return samples;
}

/** True when the named control is gone in the last frame of a sample series. */
function settledWithout(samples, name) {
  return samples.at(-1)[name] === 0;
}

/** The one-line story of a sample series: the first frame, the last frame and how many frames showed the control. */
function series(samples, name) {
  return JSON.stringify({ first: samples[0], last: samples.at(-1), framesShowing: samples.filter((sample) => sample[name] > 0).length, frames: samples.length });
}

test("Escape reaches the Map through the shell and closes Help, the Outline, the Resources panel and the selection", { skip: !enabled, timeout: 180_000 }, async () => {
  const fixture = await createFixture();
  let server = null;
  let browser = null;
  try {
    server = await startServer(fixture);
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${server.base}/?area=otto%2Ftangent`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.locator('[data-area-map-label="otto/tangent"]').waitFor();

    // Help. The Keys button opens it and Escape must close it.
    await page.getByRole("button", { name: /^Keys/ }).click();
    await page.locator(".tangent-map-help").waitFor();
    const help = await pressAndSample(page, "Escape");
    assert.ok(settledWithout(help, "help"), `Escape closes the Map keys dialog: ${series(help, "help")}`);

    // The Outline.
    await page.getByRole("button", { name: /^Outline/ }).click();
    await page.locator(".tangent-map-outline.visible").waitFor();
    const outline = await pressAndSample(page, "Escape");
    assert.ok(settledWithout(outline, "outline"), `Escape closes the Outline: ${series(outline, "outline")}`);

    // The Resources panel.
    await page.getByRole("button", { name: /^Resources/ }).click();
    await page.getByRole("heading", { name: "Map resources · tangent" }).waitFor();
    const panel = await pressAndSample(page, "Escape");
    assert.ok(settledWithout(panel, "panel"), `Escape closes the Resources panel: ${series(panel, "panel")}`);

    // A selected Area. The panel names the selected Area, so the heading says whether Escape cleared
    // the selection: with the parent Area selected the panel is the parent's, and after Escape it is
    // the located Area's again.
    const parentLabel = page.locator('[data-area-map-label="otto"]');
    await parentLabel.waitFor();
    const parentBox = await parentLabel.boundingBox();
    await page.mouse.click(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2);
    await page.getByRole("button", { name: /^Resources/ }).click();
    await page.getByRole("heading", { name: "Map resources · otto" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".tangent-map-resources").waitFor({ state: "detached" });
    const cleared = await pressAndSample(page, "Escape");
    assert.equal(cleared.at(-1).map, 1, `the Map stays mounted when Escape clears the selection: ${series(cleared, "map")}`);
    await page.getByRole("button", { name: /^Resources/ }).click();
    await page.getByRole("heading", { name: "Map resources · tangent" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".tangent-map-resources").waitFor({ state: "detached" });

    // Escape on the bare canvas with nothing open and nothing selected leaves the Map, which is home
    // here, exactly where it was.
    const bare = await pressAndSample(page, "Escape");
    assert.equal(bare.at(-1).map, 1, `Escape on the bare Map keeps the Map on screen: ${series(bare, "map")}`);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
