const ACTION_ATTRIBUTES = [
  "data-launch-start", "data-launch-for", "data-pipeline-control", "data-open-session",
  "data-open-brain", "data-verdict", "data-reply-subject", "data-goal-action",
  "data-program-action", "data-area-action", "data-modal-confirm", "data-modal-cancel",
  "data-toggle-awake", "data-stop-agent", "data-finish-run", "data-mark-complete",
  "data-mark-wont-do", "data-reopen-goal", "data-action",
  "data-stop-goal", "data-goal-recovery", "data-complete-goal", "data-wont-do-goal",
  "data-notify-document-comments",
];

const AREA_MAP_ACTIONS = new Set([
  "area_map_world_loaded", "area_map_pointer_down", "area_map_gesture", "area_map_gesture_solved", "area_map_invariant_failed",
  "area_map_projection", "area_map_save", "area_map_save_phase", "area_map_save_conflict", "area_map_retry", "area_map_draft",
  "area_map_shard_loaded", "area_map_tree_reconciled", "area_map_tree_refresh_failed", "area_map_migration_read", "area_map_recovery",
]);
const AREA_MAP_TOKENS = ["phase", "priorPhase", "outcome", "failureKind", "gestureKind", "projectionKind", "saveState", "draftState", "shardState", "invariantName"];
const AREA_MAP_IDS = ["operationId", "gestureId", "projectionId", "worldRevision", "treeRevision", "shardRevision"];
const AREA_MAP_COUNTS = ["shardCount", "areaCount", "eagerShards", "selectedCount", "affectedCount", "pendingCount", "previewCount", "elementCount", "depth", "bytes", "sampleCount"];
const AREA_MAP_FRAME_ACTIONS = new Set(["area_map_gesture_solved", "area_map_projection"]);
/** Returns one bounded machine token, or an empty value for authored-looking input. */
const safeToken = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{0,39}$/i.test(value) ? value : "";
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_ID = /^[A-Za-z0-9_-]{16}$/;
const SHARD_REVISION_ID = /^(?:[0-9a-f]{64}|(?:legacy|unreadable):[A-Za-z0-9_-]{16}|missing)$/;

/** Keeps only the machine shape generated for one correlation field. */
function safeAreaMapId(name, value) {
  const next = String(value ?? "");
  if (["operationId", "gestureId"].includes(name)) return UUID_ID.test(next) ? next : "";
  if (name === "projectionId") return /^\d{1,16}$/.test(next) ? next : "";
  if (name === "shardRevision") return SHARD_REVISION_ID.test(next) ? next : "";
  return REVISION_ID.test(next) ? next : "";
}

/** Reduces one map event to fields that cannot contain authored content or coordinates. */
export function safeAreaMapTelemetry(event = {}) {
  const action = AREA_MAP_ACTIONS.has(event.name) ? event.name : "";
  if (!action) return null;
  const entry = { action, eventStream: "area-map" };
  for (const name of AREA_MAP_IDS) {
    const value = safeAreaMapId(name, event[name]);
    if (value) entry[name] = value;
  }
  for (const name of AREA_MAP_TOKENS) {
    const value = safeToken(event[name]);
    if (value) entry[name] = value;
  }
  for (const name of AREA_MAP_COUNTS) {
    const value = Number(event[name]);
    if (Number.isInteger(value) && value >= 0) entry[name] = value;
  }
  const durationMs = Number(event.durationMs ?? event.duration ?? event.maximumTime);
  const usableTimeMs = Number(event.usableTimeMs ?? event.usableTime);
  const completeTimeMs = Number(event.completeTimeMs ?? event.completeTime);
  const status = Number(event.status);
  const retryAttempt = Number(event.retryAttempt);
  if (Number.isFinite(durationMs) && durationMs >= 0) entry.durationMs = durationMs;
  if (Number.isFinite(usableTimeMs) && usableTimeMs >= 0) entry.usableTimeMs = usableTimeMs;
  if (Number.isFinite(completeTimeMs) && completeTimeMs >= 0) entry.completeTimeMs = completeTimeMs;
  if (Number.isInteger(status) && (status === 0 || status >= 100 && status <= 599)) entry.status = status;
  if (Number.isInteger(retryAttempt) && retryAttempt >= 0) entry.retryAttempt = retryAttempt;
  for (const name of ["retryable", "idempotent"]) if (event[name] === true || event[name] === false) entry[name] = event[name];
  return entry;
}

/** Returns a stable action name without labels, typed text, paths, or document content. */
export function actionName(target) {
  const control = target?.closest?.("button, a, summary, [role='button']");
  if (!control) return "";
  for (const attribute of ACTION_ATTRIBUTES) {
    if (!control.hasAttribute(attribute)) continue;
    const value = control.getAttribute(attribute);
    return value && /^(accept|reject|undo|start|stop|restart|pause|resume|run|close|skip|retry|end|next)$/.test(value)
      ? `${attribute.slice(5)}:${value}`
      : attribute.slice(5);
  }
  return control.id ? `id:${control.id}` : control.tagName.toLowerCase();
}

/** Sends anonymous local action records; telemetry never blocks the action. */
export function createActionTelemetry(fetchJson = globalThis.fetch.bind(globalThis), now = () => performance.now(), options = {}) {
  const fetchFallback = arguments.length ? fetchJson : null;
  const beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator) ?? null;
  const areaMapFlushMs = Number.isFinite(options.areaMapFlushMs) && options.areaMapFlushMs >= 0 ? options.areaMapFlushMs : 1_000;
  const schedule = options.schedule ?? globalThis.setTimeout?.bind(globalThis);
  const cancel = options.cancel ?? globalThis.clearTimeout?.bind(globalThis);
  const pagehideTarget = options.pagehideTarget ?? globalThis;
  const areaMapFrames = new Map();
  const projectionGestures = new Map();
  let activeGestureId = "";
  let areaMapTimer = null;
  let destroyed = false;
  /** Posts one fire-and-forget local telemetry record. */
  function record(kind, action, detail = {}) {
    if (!action) return;
    const body = JSON.stringify({ kind, action, ...detail });
    if (beacon) {
      beacon("/api/telemetry/action", body);
      return;
    }
    fetchFallback?.("/api/telemetry/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  /** Observes semantic clicks and form submissions below one root. */
  function observe(root = document) {
    root.addEventListener("click", (event) => record("ui", actionName(event.target)), true);
    root.addEventListener("submit", (event) => {
      const form = event.target;
      const marker = [...(form?.attributes ?? [])].find((attribute) => attribute.name.startsWith("data-") && attribute.name.endsWith("-form"));
      record("ui", marker?.name.slice(5) ?? (form?.id ? `form:${form.id}` : "form"));
    }, true);
  }

  /** Records the completion of one Agent Shell API request. */
  function apiFinished(method, path, startedAt, status, ok) {
    if (path === "/api/telemetry/action") return;
    record("api", `${method} ${String(path).split("?")[0]}`, { durationMs: now() - startedAt, status, ok });
  }

  /** Sends each pending frame summary once and clears its delivery timer. */
  function flushAreaMap() {
    if (areaMapTimer !== null) cancel?.(areaMapTimer);
    areaMapTimer = null;
    const frames = [...areaMapFrames.values()];
    areaMapFrames.clear();
    for (const safe of frames) {
      const { action, ...detail } = safe;
      record("area-map", action, detail);
    }
  }

  /** Coalesces one solver or canvas frame into a small gesture-scoped summary. */
  function recordAreaMapFrame(safe) {
    const key = [safe.action, safe.gestureId ?? "", safe.phase ?? ""].join(":");
    const summary = areaMapFrames.get(key);
    if (!summary) {
      areaMapFrames.set(key, { ...safe, sampleCount: 1 });
    } else {
      summary.sampleCount += 1;
      for (const name of AREA_MAP_COUNTS) {
        if (name === "sampleCount" || safe[name] === undefined) continue;
        summary[name] = Math.max(summary[name] ?? 0, safe[name]);
      }
      if (safe.durationMs !== undefined) summary.durationMs = Math.max(summary.durationMs ?? 0, safe.durationMs);
      if (safe.projectionId) summary.projectionId = safe.projectionId;
      for (const name of ["projectionKind", "gestureKind"]) {
        if (!safe[name]) continue;
        summary[name] = summary[name] && summary[name] !== safe[name] ? "mixed" : safe[name];
      }
    }
    if (areaMapTimer === null && schedule) areaMapTimer = schedule(flushAreaMap, areaMapFlushMs);
  }

  /** Sends one strictly content-free Area-map lifecycle record. */
  function recordAreaMap(event) {
    if (destroyed) return;
    const safe = safeAreaMapTelemetry(event);
    if (!safe) return;
    if (safe.action === "area_map_gesture" && safe.phase === "started" && safe.gestureId) activeGestureId = safe.gestureId;
    if (safe.action === "area_map_projection" && safe.phase === "request" && safe.projectionId && activeGestureId) {
      projectionGestures.set(safe.projectionId, activeGestureId);
      if (projectionGestures.size > 64) projectionGestures.delete(projectionGestures.keys().next().value);
    }
    if (!safe.gestureId) safe.gestureId = safe.projectionId ? projectionGestures.get(safe.projectionId) ?? activeGestureId : activeGestureId;
    if (safe.action === "area_map_projection" && safe.phase === "consumed" && safe.projectionId) projectionGestures.delete(safe.projectionId);
    if (AREA_MAP_FRAME_ACTIONS.has(safe.action)) {
      recordAreaMapFrame(safe);
      return;
    }
    if (safe.action === "area_map_gesture" && safe.phase === "finished") flushAreaMap();
    const { action, ...detail } = safe;
    record("area-map", action, detail);
    if (safe.action === "area_map_gesture" && safe.phase === "finished" && safe.gestureId === activeGestureId) activeGestureId = "";
  }

  /** Flushes queued summaries and removes the page lifecycle listener. */
  function destroy() {
    if (destroyed) return;
    flushAreaMap();
    destroyed = true;
    projectionGestures.clear();
    pagehideTarget.removeEventListener?.("pagehide", flushAreaMap);
  }

  pagehideTarget.addEventListener?.("pagehide", flushAreaMap);
  return { apiFinished, destroy, flushAreaMap, observe, record, recordAreaMap, start: now };
}

export default { actionName, createActionTelemetry, safeAreaMapTelemetry };
