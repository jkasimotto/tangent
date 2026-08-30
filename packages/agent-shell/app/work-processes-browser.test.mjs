import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { serveStaticAsset } from "./static-assets.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

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

test("real Work browser shows, inspects, resumes, and removes exact-Area Processes", { skip: !enabled, timeout: 90_000 }, async () => {
  const fixture = workTableFixture();
  fixture.programs = {
    operations: [], problems: [], areas: [], liveCount: 0,
    processes: [processRecord("otto/tangent", "review"), processRecord("otto/onboarding", "digest", "paused")],
  };
  const mutations = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 404, { error: "fixture uses split projection" });
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
    assert.match(await active.textContent(), /Loop/);
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
