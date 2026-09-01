import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { areaHarnessContractText } from "./launch-environment.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const browserEnabled = process.env.TANGENT_BROWSER_TEST === "1";
const EXACT_FILE = "neara/delivery/standards/design-standards-handbook.md";

/** Reserves and releases one local port for the isolated Agent Shell. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Prefers the nvm Node on PATH so native modules use the shell's ABI. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Waits until the isolated server accepts requests. */
async function waitForServer(url, child, stderr, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start at ${url}: ${stderr()}`);
}

/** Creates a large nested vault with the required file in the final Area. */
async function productionVault(root) {
  const trees = path.join(root, "trees");
  const harnessContract = areaHarnessContractText({ registry: { modelSets: {}, effortSets: {}, harnesses: [] } });
  await mkdir(path.join(trees, ".claude"), { recursive: true });
  await writeFile(path.join(trees, "AGENTS.md"), "# Test vault\n", "utf8");
  await symlink("AGENTS.md", path.join(trees, "CLAUDE.md"));
  await symlink("../.agents/skills", path.join(trees, ".claude", "skills"));
  const parentAreas = ["neara", "neara/delivery"];
  const leafAreas = Array.from({ length: 240 }, (_, index) => `neara/delivery/team-${String(index).padStart(3, "0")}`);
  leafAreas.push("neara/delivery/standards");
  for (const area of [...parentAreas, ...leafAreas]) {
    const directory = path.join(trees, area);
    await mkdir(directory, { recursive: true });
    await mkdir(path.join(directory, ".claude"));
    const name = area.split("/").at(-1);
    await writeFile(path.join(directory, `${name}.md`), `---\ntype: work\nstatus: active\n---\n\n# ${name}\n`, "utf8");
    await writeFile(path.join(directory, "harnesses.md"), harnessContract, "utf8");
    await symlink(`${name}.md`, path.join(directory, "AGENTS.md"));
    await symlink("AGENTS.md", path.join(directory, "CLAUDE.md"));
    await symlink("../.agents/skills", path.join(directory, ".claude", "skills"));
    if (area.startsWith("neara/delivery/team-")) {
      await writeFile(path.join(directory, `reference-${name}.md`), `# Design standards background ${name}\n`, "utf8");
    }
  }
  const target = path.join(trees, EXACT_FILE);
  await writeFile(target, "# Standards handbook\n\nThe delivery standard.\n", "utf8");
  return trees;
}

/** Starts one isolated real server over a production-shaped vault. */
async function startFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "navigation-search-"));
  const trees = await productionVault(root);
  const port = await freePort();
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `navigation-search-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput = `${errorOutput}${chunk}`.slice(-8_000); });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, child, () => errorOutput);
  return { base };
}

test("the real navigation endpoint finds the exact deeply nested Document under its strict latency bound", { timeout: 30_000 }, async (context) => {
  const { base } = await startFixture(context);
  const startedAt = performance.now();
  const response = await fetch(`${base}/api/navigation/search?q=design-standards&limit=100`);
  const body = await response.json();
  const elapsed = performance.now() - startedAt;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(elapsed < 1_500, `the cold endpoint took ${elapsed.toFixed(0)}ms`);
  assert.equal(body.rows[0]?.file, EXACT_FILE);
  assert.ok(body.areas.some((area) => area.path === "neara/delivery/standards"), "the complete nested Area facet is present");
  assert.ok(body.kinds.includes("design"), "Document categories are projected independently of the result bound");

  const warmStartedAt = performance.now();
  const warm = await fetch(`${base}/api/navigation/search?q=handbook&limit=100`).then((item) => item.json());
  const warmElapsed = performance.now() - warmStartedAt;
  assert.ok(warmElapsed < 1_000, `the cached endpoint took ${warmElapsed.toFixed(0)}ms`);
  assert.ok(warm.rows.some((row) => row.file === EXACT_FILE));
});

test("real Chromium shows the exact nested Document before the browser latency bound", { skip: !browserEnabled, timeout: 45_000 }, async (context) => {
  const { base } = await startFixture(context);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Go to/ }).click();
  const startedAt = performance.now();
  await page.locator("#go-to-input").fill("design-standards");
  const row = page.locator("#go-to-list [data-go-to-row]").filter({ hasText: "Standards handbook" });
  try {
    await row.waitFor({ state: "visible", timeout: 1_500 });
  } catch (error) {
    throw new Error(`${error.message}\nFinder: ${await page.locator("#go-to-list").textContent()}`);
  }
  const elapsed = performance.now() - startedAt;

  assert.ok(elapsed < 1_500, `Chromium showed the Document in ${elapsed.toFixed(0)}ms`);
  assert.match(await row.textContent(), /Standards handbook/);
  assert.match(await row.textContent(), /neara.*delivery.*standards/i);
  assert.equal(await page.locator('#go-to-kind option[value="design"]').count(), 1, "the established Document category is available");

  await page.locator("#go-to-kind").selectOption("design");
  await page.locator("#go-to-area").selectOption("neara/delivery/standards");
  await page.locator("#go-to-input").fill("handbook");
  await row.waitFor({ state: "visible", timeout: 1_500 });
  assert.equal(await page.locator("#go-to-kind").inputValue(), "design", "a response does not clear the selected Document category");
  assert.equal(await page.locator("#go-to-area").inputValue(), "neara/delivery/standards", "a response does not clear the selected Area");

  await page.locator("#go-to-kind").selectOption("");
  await page.locator("#go-to-area").selectOption("");
  await page.locator("#go-to-input").fill("design standards background");
  await page.locator("#go-to-input").fill("design-standards");
  await row.waitFor({ state: "visible", timeout: 1_500 });
  await page.waitForTimeout(1_000);
  assert.match(await page.locator("#go-to-list [data-go-to-row]").first().textContent(), /Standards handbook/, "a cancelled or stale response cannot replace the newest exact result");
});
