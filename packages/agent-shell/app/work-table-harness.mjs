// Boots the browser shell against one Work fixture. The table's DOM, keyboard,
// focus, and state tests share this harness so every proof reads the same page.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { browserBundle } from "./test-browser-bundle.mjs";
import { AREA_FOCUS_KEY, AREA_FOCUS_SCHEMA } from "./public/area-focus-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = await browserBundle();

/** Creates the small JSON response shape the browser API helper reads. */
function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  const textValue = JSON.stringify(payload);
  /** Returns the configured response payload. */
  async function json() { return payload; }
  /** Returns the serialized response payload. */
  async function text() { return textValue; }
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { ok: status >= 200 && status < 300, status, json, text, headers: {
    /** Returns one normalized response header. */
    get: (name) => normalized.get(String(name).toLowerCase()) ?? null,
  } };
}

/** Lets promise callbacks scheduled by the evaluated browser script finish. */
export async function settle(window, turns = 3) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * Renders the Work screen for one fixture and returns its window. `posts`
 * collects every mutation the page sends, so an action proof needs no server.
 */
export async function bootWorkTable(fixture, { workFilter = "active", width = 1440, areaFocus = [], areaFocusOnly = false, workProjection = null, launchOptions = null, harnessRegistry = null, goalDetail = null, jobDetail = null, documentRecord = null, areaCanvas = null, workerCost = null, postHandler = null } = {}) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.structuredClone = globalThis.structuredClone;
  window.TextEncoder = globalThis.TextEncoder;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.__TANGENT_AREA_EDITOR_LOADER__ = async () => ({
    /** Mounts a small editor boundary; Excalidraw itself has separate browser-path coverage. */
    mountAreaBoardEditor(host, options) {
      host.innerHTML = `<div data-tangent-area-map="${options.area}"></div>`;
      return {
        /** Returns the scene supplied to the test boundary. */
        current: () => options.scene,
        /** Accepts save-state updates without rendering Excalidraw. */
        setSaveState() {},
        /** Accepts external scene replacements without rendering Excalidraw. */
        updateScene() {},
        /** Releases the inert test boundary. */
        destroy() {},
      };
    },
  });
  window.localStorage.setItem("agent-shell.work-filter", workFilter);
  if (areaFocus.length) window.localStorage.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: AREA_FOCUS_SCHEMA, areas: areaFocus, ...(areaFocusOnly ? { only: true } : {}) }));
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  const posts = [];
  const gets = [];
  let legacyRevision = 0;
  const projectedWork = workProjection ?? (() => ({ ...legacyFixtureWork(fixture), revision: ++legacyRevision }));
  window.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url, window.location.href);
    const pathname = requestUrl.pathname;
    if (options.method === "POST") {
      const body = JSON.parse(options.body ?? "{}");
      posts.push({ path: pathname, body });
      if (postHandler) {
        const response = await postHandler({ path: pathname, body, requestUrl, fixture, posts });
        if (response?.ok === false || typeof response?.json === "function") return response;
        return jsonResponse(response ?? { ok: true });
      }
      return jsonResponse({ ok: true });
    }
    gets.push(requestUrl.href);
    if (pathname === "/api/work") {
      const snapshot = typeof projectedWork === "function" ? projectedWork(requestUrl) : projectedWork;
      return jsonResponse(snapshot, { headers: { etag: `"${snapshot.epoch}:${snapshot.revision}"`, "content-length": Buffer.byteLength(JSON.stringify(snapshot)), "x-tangent-work-state": "current", "x-tangent-work-epoch": snapshot.epoch, "x-tangent-work-revision": snapshot.revision, "x-tangent-work-published-at": snapshot.publishedAt } });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    }
    if (pathname === "/api/cost") return jsonResponse({ status: "ready", days: 1, amount: 0, display: "$0", complete: true, conversations: 0, byHarness: [], byModel: [], work: [], excluded: [], computedAt: "2026-09-03T06:00:00.000Z" });
    if (pathname === "/api/cost/workers") return jsonResponse({ status: "ready", computedAt: "2026-09-03T06:00:00.000Z", work: workerCost?.work ?? {}, sessions: workerCost?.sessions ?? {} });
    if (pathname === "/api/operations") return jsonResponse(fixture.programs ?? { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options" && launchOptions) {
      return jsonResponse(typeof launchOptions === "function" ? launchOptions(requestUrl) : launchOptions);
    }
    if (pathname === "/api/harnesses" && harnessRegistry) return jsonResponse({ registry: harnessRegistry });
    if (pathname === "/api/goals/detail") {
      if (goalDetail) return jsonResponse(typeof goalDetail === "function" ? goalDetail(requestUrl) : goalDetail);
      const file = requestUrl.searchParams.get("goal");
      const goal = fixture.goals?.find((item) => item.file === file) ?? fixture.vault?.map?.flatMap((group) => group.goals ?? []).find((item) => item.file === file);
      return jsonResponse({ goal, cards: goal?.cards ?? [] });
    }
    if (pathname === "/api/brains/show") {
      const area = requestUrl.searchParams.get("area");
      return jsonResponse({ brain: fixture.brains?.find((item) => item.area === area) ?? null });
    }
    if (pathname === "/api/agents/show") {
      const session = requestUrl.searchParams.get("session");
      const summary = fixture.sessions?.find((item) => item.name === session) ?? null;
      return summary ? jsonResponse({ agent: { session, summary } }) : jsonResponse({ error: "Agent not found." }, { status: 404 });
    }
    if (pathname === "/api/jobs/show" && jobDetail) return jsonResponse(typeof jobDetail === "function" ? jobDetail(requestUrl) : jobDetail);
    if (pathname === "/api/document" && documentRecord) return jsonResponse(typeof documentRecord === "function" ? documentRecord(requestUrl) : documentRecord);
    if (pathname === "/api/areas/canvas" && areaCanvas) return jsonResponse(typeof areaCanvas === "function" ? areaCanvas(requestUrl) : areaCanvas);
    // Real Response.json() returns a fresh object for each endpoint. Keep the
    // fixture faithful when /api/work and /api/vault are read in one refresh.
    return jsonResponse(structuredClone(fixture.vault));
  };
  window.eval(bundle);
  await settle(window);
  return { window, document: window.document, posts, gets };
}

/** Converts a pre-v3 fixture to the bounded facts now used at browser boot. */
export function legacyFixtureWork(fixture) {
  const source = { version: "fixture", condition: "current" };
  const rawGoals = [...new Map([
    ...(fixture.vault?.map ?? []).flatMap((group) => group.goals ?? []),
    ...(fixture.goals ?? []).filter((goal) => !(fixture.vault?.map ?? []).some((group) => (group.goals ?? []).some((item) => item.file === goal.file))),
  ].map((goal) => [goal.file, goal])).values()];
  const goalArea = new Map(rawGoals.map((goal) => [goal.file, goal.area]));
  const parentByFile = new Map();
  for (const group of fixture.vault?.map ?? []) {
    const stack = [];
    for (const goal of group.goals ?? []) {
      const depth = Math.max(0, Number(goal.depth) || 0);
      while (stack.length > depth) stack.pop();
      parentByFile.set(goal.file, depth ? stack[depth - 1]?.file ?? null : null);
      stack[depth] = goal;
      stack.length = depth + 1;
    }
  }
  const sessions = fixture.sessions ?? [];
  const pipelines = fixture.pipelines ?? [];
  const agents = sessions.map((session) => ({
    id: session.name,
    target: session.target ?? session.name,
    role: session.kind === "brain" ? "brain" : session.kind === "repair" ? "repair" : session.kind === "work-definition" ? "definition" : "worker",
    areaId: session.area ?? goalArea.get(session.goal) ?? null,
    owner: session.kind === "brain" || session.kind === "repair"
      ? { kind: session.kind, id: session.area }
      : session.goal ? { kind: "assignment", goalId: session.goal, run: 1, assignmentId: `fixture-${session.name}` } : { kind: "none", id: null },
    liveness: "live",
    activity: ["working", "waiting", "shell"].includes(session.state) ? session.state : "starting",
    activityDetail: ["decision", "idle", "draft", "wall"].includes(session.stateDetail) ? session.stateDetail : "none",
    activitySince: isoTime(session.waitingSince ?? session.idleSince ?? session.created),
    evidence: "Fixture Agent",
    observedAt: "2026-09-01T00:00:00.000Z",
    contextUsedTokens: session.context?.usedTokens ?? null,
    cwd: session.cwd ?? null,
    launchRef: fixtureLaunch(session.launchRef ?? session.launch ?? session.command),
    createdAt: isoTime(session.created),
    workTitle: session.workTitle ?? null,
  }));
  const brainRows = (fixture.brains ?? []).map((brain) => ({
    areaId: brain.area,
    status: brain.status === "active" ? "active" : "inactive",
    generation: Math.max(0, Number(brain.generation) || 0),
    attemptId: brain.currentAttemptId ?? null,
    agentId: brain.live ? brain.session ?? null : null,
    workState: brain.live ? brain.state === "working" ? "working" : brain.state === "waiting" ? "waiting" : "unknown" : "stopped",
    attentionCount: (brain.requests ?? []).filter((request) => request.status === "open").length,
  }));
  const areas = (fixture.vault?.areas ?? []).map((area) => ({
    id: area.path,
    parentId: area.path.includes("/") ? area.path.slice(0, area.path.lastIndexOf("/")) : null,
    label: area.name ?? area.path.split("/").at(-1),
    state: area.status === "done" ? "done" : area.status === "archived" ? "archived" : "open",
    visibility: "work",
    presented: (area.presentations ?? []).map(fixturePresentation),
    morePresentedCount: 0,
  }));
  const goals = rawGoals.map((goal, rank) => {
    const storedPipeline = pipelines.find((item) => item.goal === goal.file) ?? null;
    const storedCurrent = storedPipeline?.steps?.find((step) => ["running", "waiting", "stopped", "pending"].includes(step.status)) ?? storedPipeline?.steps?.at(-1) ?? null;
    const session = sessions.find((item) => item.goal === goal.file || item.name === storedCurrent?.session || item.name === goal.session) ?? null;
    const pipeline = storedPipeline ?? (session ? { goal: goal.file, run: 1, revision: 1, status: "open", steps: [{ id: `fixture-${session.name}`, index: 1, status: "running", label: session.command ?? "agent", instruction: "", session: session.name, state: session.state, stateDetail: session.stateDetail, live: true, startedAt: session.created }] } : null);
    const current = pipeline?.steps?.find((step) => ["running", "waiting", "stopped", "pending"].includes(step.status)) ?? pipeline?.steps?.at(-1) ?? null;
    const assignment = current ? {
      id: current.id ?? `fixture-assignment-${current.index}`,
      index: Math.max(1, Number(current.index) || 1),
      total: pipeline.steps.length,
      kind: current.kind === "review" ? "review" : "implementation",
      state: ["pending", "running", "waiting", "stopped", "complete", "ended", "skipped"].includes(current.status) ? current.status : "stopped",
      label: current.label ?? `Assignment ${current.index}`,
      instructionPreview: current.instruction ?? "",
      launchRef: fixtureLaunch(current.launch),
      agentId: current.session ?? session?.name ?? null,
      startedAt: isoTime(current.startedAt),
      endedAt: isoTime(current.endedAt),
    } : null;
    const lifecycle = goal.status === "active" ? "open" : goal.status === "deferred" ? "parked" : ["open", "verify", "done", "dropped", "parked"].includes(goal.status) ? goal.status : "open";
    const code = lifecycle === "verify" ? "check" : session?.state === "working" ? "working" : session?.state === "waiting" ? "waiting" : assignment?.state === "pending" ? "assignment-pending" : assignment?.state === "stopped" ? "agent-stopped" : "open";
    return {
      id: goal.file,
      areaId: goal.area,
      parentGoalId: parentByFile.get(goal.file) ?? null,
      title: goal.title,
      lifecycle,
      verify: lifecycle === "verify",
      visibility: "work",
      rank,
      blockers: { state: (goal.dependsOn ?? []).length ? "blocked" : "ready", count: (goal.dependsOn ?? []).length },
      startedAt: isoTime(goal.firstStartAt ?? current?.startedAt),
      workState: { code, owner: ["waiting", "check", "agent-stopped"].includes(code) ? "user" : code === "working" ? "agent" : "none", since: isoTime(session?.waitingSince ?? current?.startedAt), evidence: null },
      execution: pipeline ? { run: Math.max(1, Number(pipeline.run) || 1), revision: Math.max(0, Number(pipeline.revision) || 0), state: ["open", "stopped", "complete", "parked"].includes(pipeline.status) ? pipeline.status : "open", assignment, counts: { total: pipeline.steps?.length ?? 0, final: (pipeline.steps ?? []).filter((step) => ["complete", "ended", "skipped"].includes(step.status)).length, pending: (pipeline.steps ?? []).filter((step) => step.status === "pending").length } } : null,
      presented: [...(goal.presentations ?? []).map(fixturePresentation), ...(goal.cards ?? []).map(fixtureCard)],
      morePresentedCount: 0,
      legacyStatus: goal.status,
      legacyDoneWhen: goal.doneWhen ?? "",
      legacyWaitingOn: goal.waitingOn ?? "",
      legacyFirstStartAt: goal.firstStartAt ?? null,
      legacyLastEndAt: goal.lastEndAt ?? null,
      legacyAgents: goal.agents ?? [],
      legacyChangedAt: goal.changedAt ?? goal.mtime ?? rank,
    };
  });
  const processes = (fixture.programs?.processes ?? []).map((process) => ({
    id: process.file,
    areaId: process.area,
    slug: process.slug,
    title: process.title,
    status: process.status === "paused" ? "paused" : "active",
    state: process.error ? "broken" : process.loop ? "loop" : process.due ? "waiting-for-brain" : "waiting",
    stateDetail: process.error ?? process.stateDetail ?? null,
    whenLabel: process.when ?? "",
    loop: Boolean(process.loop),
    bodyPreview: process.body ?? null,
    visibleInWork: Boolean(process.occurrenceVisible ?? process.visibleInWork ?? (process.error || (!process.loop && process.status === "active" && process.eventId && !["Dismissed", "Waiting"].includes(process.state)))),
    due: Boolean(process.due),
    brainLive: Boolean(process.brainLive),
    eventId: process.eventId ?? null,
    revision: Math.max(0, Number(process.revision) || 0),
    missedCount: Math.max(0, Number(process.missedCount) || 0),
    missedSince: isoTime(process.missedSince),
    legacyState: process.loop ? null : process.state ?? null,
    startPolicy: process.startPolicy ?? null,
    lastGoalFile: process.lastGoalFile ?? null,
    lastJobRun: process.lastJobRun ?? null,
    currentAgentSession: process.currentAgentSession ?? null,
    actionReasons: process.actionReasons ?? null,
  }));
  return { schema: "agent-shell-work.v3", fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source }, areas, goals, agents, brains: brainRows, processes, problems: [], epoch: "11111111-1111-4111-8111-111111111111", revision: 1, publishedAt: "2026-09-01T00:00:00.000Z" };
}

/** Converts a legacy presentation fixture to its bounded summary. */
function fixturePresentation(item) { return { ...item, type: "document", id: item.id ?? item.file, repository: item.repository ?? null, note: item.note ?? null, presentedBy: item.presentedBy?.session ?? item.presentedBy ?? "fixture", presentedHash: item.presentedHash ?? "" }; }
/** Converts a legacy card fixture while its detail stays behind the Goal route. */
function fixtureCard(item) { return { ...item, type: "card", presentedBy: item.presentedBy?.session ?? item.presentedBy ?? "fixture", presenterLive: item.presenterLive ?? null }; }
/** Converts a legacy launch string or object to a bounded launch reference. */
function fixtureLaunch(value) { if (!value) return null; if (typeof value === "object") return value.harness ? { harness: value.harness, model: value.model ?? null, effort: value.effort ?? null } : null; const [harness, model = null, effort = null] = String(value).split("/"); return { harness, model, effort }; }
/** Converts a fixture clock value to an ISO string. */
function isoTime(value) { const time = typeof value === "number" ? value : Date.parse(String(value ?? "")); return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null; }

/** Presses one key on the focused element, as a browser does. */
export function press(window, key, options = {}) {
  const target = window.document.activeElement ?? window.document.body;
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
