import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { serveStaticAsset } from "./static-assets.mjs";
import { legacyFixtureWork } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const oracleFile = path.join(here, "test-fixtures", "work-v3-parity", "pre-cutover.png");
const restoredFile = path.join(here, "test-fixtures", "work-v3-parity", "restored-v3.png");

/** Sends one JSON response with optional Work gateway headers. */
function sendJson(response, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers });
  response.end(body);
}

/** Counts pixel-channel differences between two PNG frames in Chromium. */
async function pixelChannelDifference(page, left, right) {
  return page.evaluate(async ({ leftUrl, rightUrl }) => {
    /** Decodes one PNG into its RGBA channels. */
    const channels = async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return [...context.getImageData(0, 0, image.width, image.height).data];
    };
    const [a, b] = await Promise.all([channels(leftUrl), channels(rightUrl)]);
    if (a.length !== b.length) return { count: Math.max(a.length, b.length), bounds: null };
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    const width = 1440;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] === b[index]) continue;
      count += 1;
      const pixel = Math.floor(index / 4);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { count, bounds: count ? { minX, minY, maxX, maxY } : null };
  }, { leftUrl: `data:image/png;base64,${left.toString("base64")}`, rightUrl: `data:image/png;base64,${right.toString("base64")}` });
}

test("real browser keeps the pre-cutover Work surface stable on bounded v3 facts", { skip: !enabled, timeout: 90_000 }, async () => {
  const fixture = workTableFixture(Date.parse("2026-09-01T01:00:00.000Z"));
  for (const goal of fixture.goals.filter((item) => item.session && !fixture.pipelines.some((job) => job.goal === item.file))) {
    const session = fixture.sessions.find((item) => item.name === goal.session);
    fixture.pipelines.push({ goal: goal.file, run: 1, revision: 1, status: "running", steps: [{ id: `assignment-${goal.slug}`, index: 1, status: "running", label: session.command, instruction: goal.title, session: session.name, state: session.state, stateDetail: session.stateDetail, live: true, startedAt: session.created }] });
  }
  let snapshot = legacyFixtureWork(fixture);
  snapshot.problems = [
    { code: "source-record-invalid", source: "jobs", count: 412, sampleIds: ["one"] },
    { code: "brain-agent-missing", source: "brains", count: 17, sampleIds: ["two"] },
  ];
  const allAreas = ["@root", "neara", "neara/delivery", "otto", "otto/onboarding", "otto/standards", "otto/tangent", "otto/tangent/deep"];
  const mixedRows = [
    { kind: "area", id: "@root", area: "@root", name: "@root", file: "README.md" },
    { kind: "area", id: "neara", area: "neara", name: "neara", file: "neara/neara.md" },
    ...Array.from({ length: 98 }, (_, index) => ({ kind: "goal", id: `otto/goal-root-${index}.md`, area: "otto", name: `Root goal ${index}`, file: `otto/goal-root-${index}.md`, status: "active" })),
  ];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, snapshot, {
      etag: `"${snapshot.epoch}:${snapshot.revision}"`,
      "x-tangent-work-state": "current",
      "x-tangent-work-epoch": snapshot.epoch,
      "x-tangent-work-revision": String(snapshot.revision),
      "x-tangent-work-published-at": snapshot.publishedAt,
    });
    if (url.pathname === "/api/navigation/search") return sendJson(response, {
      schema: "agent-shell-navigation.v1",
      query: url.searchParams.get("q") ?? "",
      limit: 100,
      rows: mixedRows,
      areas: allAreas.map((area) => ({ path: area, name: area.split("/").at(-1) })),
      areasComplete: true,
    });
    if (url.pathname === "/api/agents/show") {
      const session = url.searchParams.get("session");
      return sendJson(response, { agent: { session, summary: fixture.sessions.find((item) => item.name === session) } });
    }
    if (url.pathname.startsWith("/api/")) return sendJson(response, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(({ now }) => {
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        /** Keeps elapsed labels stable across browser runs. */
        static now() { return now; }
      };
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("agent-shell.work-filter", "active");
    }, { now: Date.parse("2026-09-01T01:05:00.000Z") });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });
    await page.locator(".work-table").waitFor();

    assert.deepEqual(await page.locator(".work-table thead th").allTextContents(), ["Goal", "Agent", "Status", "Controls"]);
    assert.equal(await page.locator("text=Last known").count(), 0);
    assert.equal(await page.locator("text=source-record-invalid").count(), 0);
    assert.equal(await page.locator("text=412").count(), 0);

    await page.mouse.move(1, 1);
    const parityFrame = await page.locator("#screen").screenshot({ animations: "disabled" });
    if (process.env.UPDATE_WORK_V3_PARITY_SCREENSHOT === "1") await writeFile(restoredFile, parityFrame);
    const [oracle, restoredEvidence] = await Promise.all([readFile(oracleFile), readFile(restoredFile)]);
    assert.deepEqual(await pixelChannelDifference(page, parityFrame, oracle), { count: 0, bounds: null }, "the restored v3 Work screen matches every pre-cutover pixel");
    assert.deepEqual(await pixelChannelDifference(page, parityFrame, restoredEvidence), { count: 0, bounds: null }, "the checked-in restored frame matches the browser result");

    const row = page.locator('tr[data-goal-anchor="otto/tangent/goal-compact-table.md"]');
    const control = row.locator(".work-agent-ref[data-focus-key]");
    await control.focus();
    await row.evaluate((element) => { window.__workParityRow = element; window.__workParityControl = document.activeElement; });
    const stableFrame = await page.locator("#screen").screenshot({ animations: "disabled" });

    for (let revision = 2; revision <= 4; revision += 1) {
      snapshot = { ...snapshot, revision, publishedAt: `2026-09-01T01:00:0${revision}.000Z` };
      await page.evaluate(async () => { await (await import("/shell.js")).refresh(); });
    }
    const afterEquivalent = await page.locator("#screen").screenshot({ animations: "disabled" });
    assert.deepEqual(afterEquivalent, stableFrame, "equivalent revisions do not change a frame");
    assert.equal(await row.evaluate((element) => element === window.__workParityRow), true, "the keyed row stays mounted");
    assert.equal(await control.evaluate((element) => element === window.__workParityControl), true, "the focused control stays mounted");
    assert.equal(await control.evaluate((element) => element === document.activeElement), true, "focus stays on the same control");

    const changed = structuredClone(snapshot);
    const goal = changed.goals.find((item) => item.id === "otto/tangent/goal-compact-table.md");
    const agent = changed.agents.find((item) => item.id === goal.execution.assignment.agentId);
    goal.workState = { ...goal.workState, code: "waiting", owner: "user", evidence: "The Agent needs a decision." };
    agent.activity = "waiting";
    agent.activityDetail = "decision";
    changed.revision += 1;
    snapshot = changed;
    await page.evaluate(async () => { await (await import("/shell.js")).refresh(); });
    assert.equal(await row.evaluate((element) => element === window.__workParityRow), true, "changed facts reconcile the keyed row in place");
    assert.equal(await control.evaluate((element) => element === window.__workParityControl && element === document.activeElement), true, "changed facts retain focus");
    assert.match(await row.locator(".desk-state").textContent(), /Needs your decision/);

    await page.getByRole("button", { name: /Go to/ }).click();
    await page.locator("#go-to-area option").last().waitFor({ state: "attached" });
    assert.equal(await page.locator("#go-to-area option").count(), allAreas.length + 1, "the filter uses the complete Area facet");
    assert.equal(await page.locator('#go-to-area option[value="otto/tangent/deep"]').count(), 1, "a descendant after 100 root rows remains selectable");

    await page.keyboard.press("Escape");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
