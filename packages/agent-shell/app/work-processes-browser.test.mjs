import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { serveStaticAsset } from "./static-assets.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";
import { legacyFixtureWork } from "./work-table-harness.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** Sends one JSON fixture response. */
function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** Reads one request body as JSON. */
async function readJson(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

/** One Process projection used by the real shell. */
function processRecord(area, slug, status = "active") {
  return {
    area, slug, file: `${area}/process-${slug}.md`, title: slug, loop: true,
    status, error: "", brainLive: true, every: "20m", body: `Review ${slug}.`,
    when: "Every 20m, to the brain", state: status === "paused" ? "Paused" : "Loop",
    nextRunAt: status === "paused" ? null : "2026-08-31T10:20:00.000Z", lastRunAt: "2026-08-31T10:00:00.000Z",
  };
}

/** One due timed Process with the complete Work action projection. */
function timedProcess(area, slug, state = "Start it?") {
  return {
    area, slug, file: `${area}/process-${slug}.md`, title: slug, loop: false,
    status: "active", error: "", brainLive: false, startPolicy: state === "Start it?" ? "ask" : "auto",
    when: "Daily 09:00 UTC", state, stateDetail: "", due: state !== "Running",
    revision: 4, eventId: `${slug}-event`, missedCount: 0,
    lastGoalFile: null, lastJobRun: null, currentAgentSession: null,
    actionReasons: { start: null, retry: null, defer: null, skip: null, readRun: "This Process has no run yet.", stop: "No Process Agent is running." },
  };
}

test("real Work browser shows, inspects, resumes, and removes exact-Area Processes", { skip: !enabled, timeout: 90_000 }, async () => {
  const fixture = workTableFixture();
  fixture.programs = {
    operations: [], problems: [], areas: [], liveCount: 0,
    processes: [processRecord("otto/tangent", "review"), processRecord("otto/onboarding", "digest", "paused")],
  };
  const mutations = [];
  let revision = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 200, { ...legacyFixtureWork(fixture), revision: ++revision });
    if (url.pathname === "/api/vault") return sendJson(response, 200, fixture.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "process-proof", pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, fixture.programs);
    if (url.pathname === "/api/document") {
      const file = url.searchParams.get("file");
      return sendJson(response, 200, { file, area: file.split("/process-")[0], kind: "document", title: path.basename(file, ".md"), text: "# Process\n\nReview the work.", hash: "process-proof", comments: [], links: [] });
    }
    if (request.method === "POST" && ["/api/processes/control", "/api/processes/remove"].includes(url.pathname)) {
      const body = await readJson(request);
      mutations.push({ path: url.pathname, body });
      const index = fixture.programs.processes.findIndex((item) => item.area === body.area && item.slug === body.slug && item.file === body.file);
      if (index < 0) return sendJson(response, 409, { error: "the exact Process is gone" });
      if (url.pathname.endsWith("/remove")) {
        fixture.programs.processes.splice(index, 1);
        return sendJson(response, 200, { ok: true, file: body.file, area: body.area, slug: body.slug });
      }
      const item = fixture.programs.processes[index];
      item.status = body.action === "resume" ? "active" : "paused";
      item.state = item.status === "paused" ? "Paused" : "Loop";
      return sendJson(response, 200, { ok: true, process: item });
    }
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });

    const active = page.locator('[data-work-group="otto/tangent"] .work-process-row', { hasText: "review" });
    const paused = page.locator('[data-work-group="otto/onboarding"] .work-process-row', { hasText: "digest" });
    await active.waitFor();
    await paused.waitFor();
    assert.match(await active.textContent(), /Brain on/);
    assert.match(await paused.textContent(), /Paused/);

    await active.getByRole("button", { name: "Inspect process review" }).first().click();
    await page.locator(".document-reader").waitFor();
    assert.match(await page.locator(".document-reader").textContent(), /Review the work/);
    await page.keyboard.press("Escape");

    const resume = paused.getByRole("button", { name: "Resume process digest in Otto / Onboarding" });
    await resume.focus();
    await page.keyboard.press("Enter");
    await paused.getByRole("button", { name: "Pause process digest in Otto / Onboarding" }).waitFor();

    page.once("dialog", (dialog) => dialog.accept());
    await active.getByRole("button", { name: "Remove loop review from Otto / Tangent" }).click();
    await active.waitFor({ state: "detached" });
    assert.deepEqual(mutations, [
      { path: "/api/processes/control", body: { area: "otto/onboarding", slug: "digest", file: "otto/onboarding/process-digest.md", action: "resume" } },
      { path: "/api/processes/remove", body: { area: "otto/tangent", slug: "review", file: "otto/tangent/process-review.md" } },
    ]);
    assert.equal(await page.locator('[data-focus-key="area:otto/tangent"]').evaluate((element) => element === document.activeElement), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("real Work browser navigates timed Processes, asks on x, and opens auto-started linked Jobs", { skip: !enabled, timeout: 90_000 }, async () => {
  const fixture = workTableFixture();
  const ask = timedProcess("otto/onboarding", "ask-nightly");
  const automatic = timedProcess("otto/tangent", "auto-digest", "Running");
  const linkedGoal = {
    area: "otto/tangent", slug: "auto-digest-linked", file: "otto/tangent/goal-auto-digest-linked.md",
    title: "auto-digest", status: "active", doneWhen: "auto-digest is done.", waitingOn: "", depth: 0, order: 99,
    dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [], session: "auto-digest-worker",
  };
  automatic.brainLive = true;
  automatic.lastGoalFile = linkedGoal.file;
  automatic.lastJobRun = 1;
  automatic.currentAgentSession = "auto-digest-worker";
  automatic.actionReasons = { ...automatic.actionReasons, readRun: null, stop: null, start: "The Process is already starting or running." };
  fixture.vault.areas.find((area) => area.path === "otto/tangent").goals.push(linkedGoal);
  fixture.vault.map.find((area) => area.path === "otto/tangent").goals.push(linkedGoal);
  fixture.pipelines.push({
    goal: linkedGoal.file, run: 1, revision: 2, status: "open", currentAssignmentId: "auto-assignment",
    steps: [{ id: "auto-assignment", index: 1, status: "running", instruction: "Run auto digest.", session: "auto-digest-worker", live: true }],
  });
  fixture.sessions.push({ name: "auto-digest-worker", goal: linkedGoal.file, state: "working", command: "codex" });
  fixture.programs = { operations: [], problems: [], areas: [], liveCount: 0, processes: [ask, automatic] };
  const mutations = [];
  let revision = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 200, { ...legacyFixtureWork(fixture), revision: ++revision });
    if (url.pathname === "/api/vault") return sendJson(response, 200, fixture.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "timed-process-proof", pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, fixture.programs);
    if (url.pathname === "/api/document") {
      const file = url.searchParams.get("file");
      return sendJson(response, 200, { file, area: file.split("/goal-")[0], kind: "document", title: path.basename(file, ".md"), text: `# ${path.basename(file, ".md")}\n\nLinked Process run.`, hash: "timed-process-proof", comments: [], links: [] });
    }
    if (url.pathname === "/api/goals/detail") {
      const file = url.searchParams.get("goal");
      const goal = fixture.vault.areas.flatMap((area) => area.goals).find((item) => item.file === file);
      const queue = fixture.pipelines.find((item) => item.goal === file) ?? null;
      return sendJson(response, 200, { goal, queue, job: queue, runs: queue ? [{ run: queue.run, status: queue.status, revision: queue.revision }] : [], attempts: [], dependencies: {}, relatedDocuments: [], cards: [] });
    }
    if (request.method === "POST" && url.pathname === "/api/processes/request-start") {
      const body = await readJson(request);
      mutations.push(body);
      const goal = {
        area: ask.area, slug: "ask-nightly-linked", file: `${ask.area}/goal-ask-nightly-linked.md`, title: ask.title,
        status: "active", doneWhen: `${ask.title} is done.`, waitingOn: "", depth: 0, order: 99,
        dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [], session: "ask-nightly-worker",
      };
      fixture.vault.areas.find((area) => area.path === ask.area).goals.push(goal);
      fixture.vault.map.find((area) => area.path === ask.area).goals.push(goal);
      fixture.pipelines.push({ goal: goal.file, run: 1, revision: 2, status: "open", currentAssignmentId: "ask-assignment", steps: [{ id: "ask-assignment", index: 1, status: "running", instruction: "Run nightly.", session: "ask-nightly-worker", live: true }] });
      fixture.sessions.push({ name: "ask-nightly-worker", goal: goal.file, state: "working", command: "codex" });
      Object.assign(ask, { state: "Running", due: false, brainLive: true, lastGoalFile: goal.file, lastJobRun: 1, currentAgentSession: "ask-nightly-worker", revision: 5, actionReasons: { ...ask.actionReasons, start: "The Process is already starting or running.", readRun: null, stop: null } });
      return sendJson(response, 202, { process: ask, eventId: ask.eventId, attemptId: "ask-attempt", delivery: "delivered" });
    }
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });

    const askRow = page.locator(`[data-work-cursor="process:${ask.file}"]`);
    await askRow.locator(".work-cell-status").click();
    await page.keyboard.press("k");
    assert.notEqual(await page.locator("[data-work-cursor].cursor").getAttribute("data-work-cursor"), `process:${ask.file}`);
    await page.keyboard.press("j");
    assert.equal(await page.locator("[data-work-cursor].cursor").getAttribute("data-work-cursor"), `process:${ask.file}`, "j and k include the Process row in normal Work order");

    await page.keyboard.press("x");
    const menu = page.getByRole("dialog", { name: "ask-nightly" });
    await menu.getByRole("menuitem", { name: /Start now/ }).click();
    await page.locator(`[data-work-cursor="process:${ask.file}"] .desk-state`, { hasText: "Running" }).waitFor();
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].file, ask.file);
    assert.equal(mutations[0].eventId, ask.eventId);

    const autoRow = page.locator(`[data-work-cursor="process:${automatic.file}"]`);
    assert.match(await autoRow.textContent(), /Running/);
    await autoRow.locator(".work-cell-status").click();
    await page.keyboard.press("o");
    await page.locator(".document-reader").waitFor();
    assert.match(await page.locator(".document-reader").textContent(), /Linked Process run/);
    assert.match(await page.locator(".document-reader").textContent(), /Run auto digest/);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
