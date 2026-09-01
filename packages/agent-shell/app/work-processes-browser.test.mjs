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
    actionReasons: { start: null, retry: null, defer: null, dismiss: null, readRun: "This Process has no run yet.", stop: "No Process Agent is running." },
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
    if (url.pathname === "/api/tree") return sendJson(response, 200, { root: "/fixture", areas: fixture.vault.areas });
    if (url.pathname === "/api/areas/show") {
      const area = url.searchParams.get("area");
      const item = fixture.vault.areas.find((candidate) => candidate.path === area);
      return sendJson(response, 200, { ...item, goals: item?.goals ?? [], documents: [], processes: fixture.programs.processes.filter((process) => process.area === area) });
    }
    if (url.pathname === "/api/processes") {
      const area = url.searchParams.get("area");
      return sendJson(response, 200, { processes: fixture.programs.processes.filter((process) => !area || process.area === area) });
    }
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

    assert.equal(await page.locator(".work-process-row").count(), 0, "loop and paused definitions do not become occurrence rows");
    await page.locator('[data-open-area-processes="otto/tangent"]').evaluate((element) => element.click());
    let active = page.locator(".process-row", { hasText: "review" });
    await active.waitFor();
    assert.match(await active.textContent(), /Brain on/);

    await active.locator(".process-open").click();
    await page.locator(".document-reader").waitFor();
    assert.match(await page.locator(".document-reader").textContent(), /Review the work/);
    await page.keyboard.press("Escape");

    await page.locator('[data-select-area="otto/onboarding"]').click();
    const paused = page.locator(".process-row", { hasText: "digest" });
    const resume = paused.getByRole("button", { name: "Resume process digest in Otto / Onboarding" });
    await resume.focus();
    await page.keyboard.press("Enter");
    await paused.getByRole("button", { name: "Pause process digest in Otto / Onboarding" }).waitFor();

    await page.locator('[data-select-area="otto/tangent"]').click();
    active = page.locator(".process-row", { hasText: "review" });
    page.once("dialog", (dialog) => dialog.accept());
    await active.getByRole("button", { name: "Remove loop review from Otto / Tangent" }).click();
    await active.waitFor({ state: "detached" });
    assert.deepEqual(mutations, [
      { path: "/api/processes/control", body: { area: "otto/onboarding", slug: "digest", file: "otto/onboarding/process-digest.md", action: "resume" } },
      { path: "/api/processes/remove", body: { area: "otto/tangent", slug: "review", file: "otto/tangent/process-review.md" } },
    ]);
    assert.equal(await page.locator('[data-select-area="otto/tangent"]').evaluate((element) => element === document.activeElement || element.closest(".area-tree-row")?.classList.contains("selected")), true);
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

test("real Work browser dismisses one occurrence, restores it, and returns the Area at the next slot", { skip: !enabled, timeout: 90_000 }, async () => {
  const fixture = workTableFixture();
  const area = { path: "otto/occurrence", name: "occurrence", goals: [], documents: [] };
  fixture.vault.areas.push(area);
  fixture.vault.map.push({ path: area.path, name: area.name, goals: [] });
  const occurrence = timedProcess(area.path, "daily-review");
  occurrence.occurrenceVisible = true;
  occurrence.nextRunAt = "2026-09-02T09:00:00.000Z";
  fixture.programs = { operations: [], problems: [], areas: [], liveCount: 0, processes: [occurrence] };
  const mutations = [];
  let revision = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 200, { ...legacyFixtureWork(fixture), revision: ++revision });
    if (url.pathname === "/api/vault") return sendJson(response, 200, fixture.vault);
    if (url.pathname === "/api/tree") return sendJson(response, 200, { root: "/fixture", areas: fixture.vault.areas });
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "dismiss-proof", pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, fixture.programs);
    if (url.pathname === "/api/areas/show") return sendJson(response, 200, { ...area, processes: [occurrence] });
    if (url.pathname === "/api/processes") return sendJson(response, 200, { processes: [occurrence] });
    if (request.method === "POST" && url.pathname === "/api/processes/dismiss") {
      const body = await readJson(request);
      mutations.push({ path: url.pathname, body });
      if (body.eventId !== occurrence.eventId || Number(body.expectedRevision) !== occurrence.revision) return sendJson(response, 409, { error: "the Process event changed" });
      occurrence.occurrenceVisible = false;
      occurrence.state = "Dismissed";
      occurrence.due = false;
      occurrence.dismissedEventId = occurrence.eventId;
      occurrence.lastOccurrenceOutcome = "dismissed";
      occurrence.restoreAvailable = true;
      occurrence.restoreReason = null;
      occurrence.revision += 1;
      return sendJson(response, 200, { process: occurrence, eventId: occurrence.eventId, returnRule: { kind: "calendar", nextDueAt: occurrence.nextRunAt } });
    }
    if (request.method === "POST" && url.pathname === "/api/processes/restore") {
      const body = await readJson(request);
      mutations.push({ path: url.pathname, body });
      if (!occurrence.restoreAvailable || body.eventId !== occurrence.dismissedEventId || Number(body.expectedRevision) !== occurrence.revision) return sendJson(response, 409, { error: "A newer occurrence exists." });
      occurrence.occurrenceVisible = true;
      occurrence.state = "Start it?";
      occurrence.due = true;
      occurrence.dismissedEventId = null;
      occurrence.lastOccurrenceOutcome = null;
      occurrence.restoreAvailable = false;
      occurrence.restoreReason = "There is no dismissed occurrence to restore.";
      occurrence.revision += 1;
      return sendJson(response, 200, { process: occurrence, eventId: occurrence.eventId });
    }
    if (request.method === "POST" && url.pathname === "/test/next") {
      const replacedEventId = occurrence.dismissedEventId;
      occurrence.eventId = "daily-review-event-2";
      occurrence.occurrenceVisible = true;
      occurrence.state = "Start it?";
      occurrence.due = true;
      occurrence.dismissedEventId = replacedEventId;
      occurrence.lastOccurrenceOutcome = "dismissed";
      occurrence.restoreAvailable = false;
      occurrence.restoreReason = "A newer occurrence exists.";
      occurrence.revision += 1;
      return sendJson(response, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.addInitScript(() => localStorage.setItem("agent-shell.active-only", "true"));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });

    /** Dismisses the current row through the real x menu. */
    const dismiss = async () => {
      const row = page.locator(`[data-work-cursor="process:${occurrence.file}"]`);
      await row.locator(".work-cell-status").click();
      await page.keyboard.press("x");
      const menu = page.getByRole("dialog", { name: "daily-review" });
      const action = menu.getByRole("menuitem", { name: "Dismiss this occurrence" });
      assert.match(await menu.textContent(), /Hide this occurrence from Work\. The next due occurrence returns\./);
      await action.click();
      await page.locator(`[data-work-group="${area.path}"]`).waitFor({ state: "detached" });
    };

    await dismiss();
    assert.match(await page.locator("#toast").textContent(), /Dismissed this occurrence\. Next due/);
    assert.match(await page.locator("#filter-count").textContent(), /Dismissed/);
    const focusedCursor = await page.evaluate(() => document.activeElement?.closest?.("[data-work-cursor]")?.getAttribute("data-work-cursor") || "");
    assert.notEqual(focusedCursor, `process:${occurrence.file}`, "focus moves to a surviving Work row");
    assert.notEqual(focusedCursor, "");
    await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(`[data-work-cursor="process:${occurrence.file}"]`).waitFor();
    assert.equal(mutations.at(-1).path, "/api/processes/restore");

    await dismiss();
    await page.locator("#areas-tab").evaluate((element) => element.click());
    await page.locator(`[data-select-area="${area.path}"]`).click();
    const processRow = page.locator(".process-row", { hasText: "daily-review" });
    assert.match(await processRow.textContent(), /Last occurrence: Dismissed/);
    await processRow.getByRole("button", { name: "Start process daily-review now" }).waitFor();
    const restore = processRow.getByRole("button", { name: "Restore occurrence for process daily-review" });
    await restore.click();
    for (let attempt = 0; attempt < 40 && mutations.at(-1)?.path !== "/api/processes/restore"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mutations.at(-1)?.path, "/api/processes/restore", "the Area-table button uses the exact restore route");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`[data-work-cursor="process:${occurrence.file}"]`).waitFor();

    await dismiss();
    await page.evaluate(async () => { await fetch("/test/next", { method: "POST" }); });
    await page.reload({ waitUntil: "networkidle" });
    const returned = page.locator(`[data-work-cursor="process:${occurrence.file}"]`);
    await returned.waitFor();
    assert.equal(await returned.getAttribute("data-process-event"), "daily-review-event-2", "the next scheduled slot returns without Resume");
    await page.locator("#areas-tab").evaluate((element) => element.click());
    await page.locator(`[data-select-area="${area.path}"]`).click();
    const unavailable = page.getByRole("button", { name: "Restore occurrence for process daily-review" });
    assert.equal(await unavailable.isDisabled(), true);
    const reasonId = await unavailable.getAttribute("aria-describedby");
    assert.equal(await page.locator(`#${reasonId}`).textContent(), "A newer occurrence exists.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
