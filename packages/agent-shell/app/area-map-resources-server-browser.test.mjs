import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { areaCanvasPath, parseAreaCanvas } from "./area-canvas.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

// This regression drives the unmodified production server, its real catalog
// transaction, the composed-world placement, and the built shell page in one
// browser. Every other Map-resource browser test serves a static fixture.
const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core"), "utf8");
const execFileAsync = promisify(execFile);
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

/** Runs one Git command inside a fixture directory and returns trimmed stdout. */
async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

/** Creates a temporary vault with one child Area plus one repository and two real Git worktrees. */
async function createFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "map-resources-server-browser-")));
  const trees = path.join(root, "trees");
  for (const area of ["otto", "otto/tangent"]) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nFixture Area.\n## Resources\n\n`, "utf8");
  }
  await git(trees, "init", "--quiet");
  await git(trees, "config", "user.email", "resource-test@tangent.local");
  await git(trees, "config", "user.name", "Resource Test");
  await git(trees, "add", ".");
  await git(trees, "commit", "--quiet", "-m", "add: resource fixture");

  const repo = path.join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "--quiet", "-b", "main");
  await git(repo, "config", "user.email", "resource-test@tangent.local");
  await git(repo, "config", "user.name", "Resource Test");
  await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "--quiet", "-m", "init");
  const feature = path.join(root, "worktrees", "feature");
  const review = path.join(root, "worktrees", "review");
  await mkdir(path.dirname(feature), { recursive: true });
  await git(repo, "worktree", "add", "--quiet", "-b", "feature/one", feature);
  await git(repo, "worktree", "add", "--quiet", "-b", "review/two", review);
  const shared = path.join(root, "shared");
  await mkdir(shared);
  await git(shared, "init", "--quiet", "-b", "main");
  return { root, trees, repo, feature, review, shared };
}

/** Waits until the isolated production server responds or reports its early exit. */
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
      TANGENT_SHELL_INSTANCE_ID: `map-resources-server-browser-${process.pid}`,
      CHAT_SESSION: `map-resources-server-browser-${process.pid}`,
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

/** Fetches one JSON route and preserves both HTTP status and typed payload. */
async function request(server, resource, body = undefined) {
  const response = await fetch(`${server.base}${resource}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: await response.json() };
}

/** Adds one worktree to the Area catalog and places its Block through the real server. */
async function addAndPlaceWorktree(server, index, label, target) {
  const inspected = await request(server, "/api/areas/map-resources/inspect-target", { kind: "worktree", path: target });
  assert.equal(inspected.status, 200, JSON.stringify(inspected.value));
  assert.equal(inspected.value.state, "available");
  const projection = (await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value;
  const added = await request(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId: `browser-add-${index}`,
    viewedFrom: "otto/tangent",
    mutation: { kind: "add", owner: "otto/tangent", input: { target: inspected.value.normalized, missingConfirmation: null }, label },
    expectedCatalogs: projection.catalogs.filter((item) => item.owner === "otto/tangent"),
  });
  assert.equal(added.status, 200, JSON.stringify(added.value));
  const placed = await request(server, "/api/areas/map-resources/representation", {
    schema: "area-map-resource-representation.v1",
    operationId: `browser-place-${index}`,
    kind: "place",
    viewedFrom: "otto/tangent",
    resource: added.value.resource.locator,
  });
  assert.equal(placed.status, 200, JSON.stringify(placed.value));
  assert.equal(placed.value.representation, "on-map");
  return added.value.resource.locator;
}

/** Adds one never-placed repository resource so the browser can place it by pointer. */
async function addRepository(server, label, target) {
  const inspected = await request(server, "/api/areas/map-resources/inspect-target", { kind: "repository", path: target });
  assert.equal(inspected.status, 200, JSON.stringify(inspected.value));
  const projection = (await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value;
  const added = await request(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId: "browser-add-repository",
    viewedFrom: "otto/tangent",
    mutation: { kind: "add", owner: "otto/tangent", input: { target: inspected.value.normalized, missingConfirmation: null }, label },
    expectedCatalogs: projection.catalogs.filter((item) => item.owner === "otto/tangent"),
  });
  assert.equal(added.status, 200, JSON.stringify(added.value));
  return added.value.resource.locator;
}

/** Returns only axe findings that block the accepted serious/critical proof floor. */
async function seriousAccessibilityViolations(page) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes[0]?.html ?? ""}`);
  });
}

/** Reads the browser clipboard through the real permission-granted API. */
async function clipboardText(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Reads the current live status announcements. */
async function announcements(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((element) => element.textContent.trim()).filter(Boolean));
}

test("the built shell copies exact worktree paths and places a resource by pointer through a real server and temporary vault", { skip: !enabled, timeout: 120_000 }, async () => {
  const fixture = await createFixture();
  let server = null;
  let browser = null;
  try {
    server = await startServer(fixture);
    const worktrees = [
      ["Main checkout", fixture.repo],
      ["Feature checkout", fixture.feature],
      ["Review checkout", fixture.review],
    ];
    for (const [index, [label, target]] of worktrees.entries()) await addAndPlaceWorktree(server, index + 1, label, target);
    const sharedLocator = await addRepository(server, "Shared repository", fixture.shared);

    const catalog = JSON.parse(await readFile(path.join(fixture.trees, "otto", "tangent", "map-resources.json"), "utf8"));
    assert.equal(catalog.schema, "area-map-resources.v1");
    const targets = catalog.resources.map((row) => row?.target?.path).filter(Boolean).sort();
    assert.deepEqual(targets, [...worktrees.map(([, target]) => target), fixture.shared].sort(), "the vault catalog records every exact target path");
    const parsed = parseAreaCanvas(await readFile(path.join(fixture.trees, areaCanvasPath("otto/tangent")), "utf8"));
    assert.equal(parsed.ok, true, parsed.errors?.join("; "));
    const resourceBlocks = parsed.scene.elements.filter((element) => element.customData?.tangent?.kind === "resource" && !element.isDeleted);
    assert.equal(resourceBlocks.length, 3, "placement wrote one resource Block per worktree into the Area scene");
    const vaultHead = await git(fixture.trees, "rev-parse", "HEAD");

    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const context = await browser.newContext({ viewport: { width: 800, height: 720 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${server.base}/?area=otto%2Ftangent`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();

    await page.getByRole("button", { name: "Outline" }).click();
    const outline = page.locator(".tangent-map-outline.visible");
    await outline.waitFor();
    await page.getByRole("treeitem", { name: /^tangent, .*3 blocks$/ }).waitFor();
    for (const [label, target] of worktrees) {
      const name = await page.getByRole("treeitem", { name: new RegExp(`^Worktree: ${label}\\.`) }).getAttribute("aria-label");
      assert.ok(name.includes("Area otto/tangent"), `Outline names the owning Area for ${label}: ${name}`);
      assert.ok(name.includes(`Target ${target}.`), `Outline names the exact target for ${label}: ${name}`);
      assert.ok(name.endsWith("Copy path with Enter."), `Outline teaches the keyboard action for ${label}: ${name}`);
    }
    const featureItem = page.getByRole("treeitem", { name: /^Worktree: Feature checkout\./ });
    await featureItem.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Copied Feature checkout path." }).waitFor();
    assert.equal(await clipboardText(page), fixture.feature, "Outline Enter copies the exact absolute path with no newline");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Worktree: Feature checkout.")), true, "copy keeps focus on the Outline row");
    await outline.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".tangent-map-outline.visible").waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Map resources · tangent" }).waitFor();
    const reviewRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Review checkout" });
    await reviewRow.getByRole("button", { name: /^Copy path\./ }).click();
    await page.getByRole("status").filter({ hasText: "Copied Review checkout path." }).waitFor();
    assert.equal(await clipboardText(page), fixture.review, "the panel Copy path button copies the same exact path grammar");
    await reviewRow.getByRole("button", { name: /^Details\./ }).click();
    const details = page.locator(".tangent-map-resource-details");
    await details.getByRole("heading", { name: "Review checkout" }).waitFor();
    assert.equal(await details.getByRole("textbox").inputValue(), fixture.review, "Details shows the same exact path that was copied");
    await details.locator("code").filter({ hasText: fixture.repo }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "a long temporary path never creates horizontal page scroll at 800px");
    assert.deepEqual(await seriousAccessibilityViolations(page), []);
    await details.getByRole("button", { name: "Back to resources" }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    assert.equal(await git(fixture.trees, "rev-parse", "HEAD"), vaultHead, "copying paths never writes the vault");
    assert.equal(await git(fixture.trees, "status", "--porcelain"), "", "copying paths leaves the vault clean");
    assert.ok((await announcements(page)).some((text) => text === "Saved"), "the Map stays saved after copy actions");

    // Pointer placement: the never-placed repository becomes a Block where the pointer commits.
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Map resources · tangent" }).waitFor();
    const sharedRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Shared repository" });
    await sharedRow.getByRole("button", { name: /^Place on Map\./ }).click();
    const placement = page.getByRole("status", { name: "Place Shared repository on the Map" });
    await placement.waitFor();
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), false, "placement hands pointer ownership back to the Map");
    const canvas = await page.locator(".excalidraw canvas.interactive").boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.62);
    await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.62);
    await placement.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Outline" }).click();
    await page.getByRole("treeitem", { name: /^Repository: Shared repository\./ }).waitFor();
    await page.getByRole("treeitem", { name: /^tangent, .*4 blocks$/ }).waitFor();
    await outline.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor();
    assert.equal(await git(fixture.trees, "rev-list", "--count", `${vaultHead}..HEAD`), "1", "pointer placement commits exactly one vault transaction");
    const placedScene = parseAreaCanvas(await readFile(path.join(fixture.trees, areaCanvasPath("otto/tangent")), "utf8"));
    const sharedBlock = placedScene.scene.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === sharedLocator.id && !element.isDeleted);
    assert.ok(sharedBlock, "the placed repository Block references its catalog association");
    assert.equal((await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value.rows.find((row) => row.entity.locator.id === sharedLocator.id).entity.representation.value, "on-map");
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
