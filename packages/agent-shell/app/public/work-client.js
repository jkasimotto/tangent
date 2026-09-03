const WORK_SCHEMA = "agent-shell-work.v3";
const HARD_LIMIT_BYTES = 1024 * 1024;

/** Creates the one serialized Work reader and its session cache. */
export function createWorkClient({ fetchImpl = globalThis.fetch, session = globalThis.sessionStorage, config = globalThis.TANGENT_WORK ?? {}, deadlineMs = 5_000, now = Date.now, record = () => {} } = {}) {
  let current = readCache(session, config);
  let metadata = current ? { state: "stale", staleReason: "browser-cache", epoch: current.epoch, revision: current.revision, publishedAt: current.publishedAt, observedAt: null, gatewayBoot: "", controllerBoot: "" } : null;
  let active = null;
  let trailing = false;

  /** Reads Work while allowing only one active and one trailing request. */
  async function read() {
    if (active) { trailing = true; return active; }
    active = request().finally(() => {
      active = null;
      if (trailing) { trailing = false; void read(); }
    });
    return active;
  }

  /** Performs one bounded conditional Work request. */
  async function request() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    const startedAt = now();
    try {
      const headers = current?.etag ? { "if-none-match": current.etag } : {};
      const response = await fetchImpl("/api/work", { headers, signal: controller.signal });
      const nextMetadata = transportMetadata(response.headers);
      if (response.status === 304 && current) {
        metadata = nextMetadata;
        record("work_refresh_total", 1, { result: "not-modified" });
        return { snapshot: current.snapshot, metadata, changed: false, durationMs: now() - startedAt };
      }
      if (!response.ok) throw httpError(response.status, await response.json().catch(() => ({})), response.headers);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > HARD_LIMIT_BYTES) throw new Error("Work response exceeds 1 MiB.");
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > HARD_LIMIT_BYTES) throw new Error("Work response exceeds 1 MiB.");
      const snapshot = JSON.parse(text);
      validateSnapshot(snapshot, config);
      if (current && snapshot.epoch === current.snapshot.epoch && snapshot.revision < current.snapshot.revision) {
        return { snapshot: current.snapshot, metadata, changed: false, ignored: "lower-revision", durationMs: now() - startedAt };
      }
      const changed = !current || snapshot.epoch !== current.snapshot.epoch || snapshot.revision > current.snapshot.revision;
      current = { snapshot, etag: response.headers.get("etag") || "", epoch: snapshot.epoch, revision: snapshot.revision, publishedAt: snapshot.publishedAt };
      metadata = nextMetadata;
      writeCache(session, config, current);
      record("work_refresh_total", 1, { result: changed ? "changed" : "equal" });
      return { snapshot, metadata, changed, durationMs: now() - startedAt };
    } catch (error) {
      error.kind ??= error.name === "AbortError" ? "timeout" : "transport";
      error.retained = current?.snapshot ?? null;
      record("work_refresh_total", 1, { result: error.kind });
      if (current) record("work_retained_on_error_total", 1, { kind: error.kind });
      throw error;
    } finally { clearTimeout(timeout); }
  }

  /** Returns a valid cached snapshot for this rollout. */
  function hydrate() { return current ? { snapshot: current.snapshot, metadata, changed: true, hydrated: true } : null; }
  /** Returns the last accepted Work state. */
  function state() { return { snapshot: current?.snapshot ?? null, metadata }; }
  return { read, hydrate, state };
}

/** Validates the browser-visible subset of one v3 snapshot. */
function validateSnapshot(value, config) {
  if (!value || value.schema !== WORK_SCHEMA) throw new Error("Work response has the wrong schema.");
  if (!value.epoch || !Number.isInteger(value.revision) || value.revision < 1) throw new Error("Work response has an invalid identity.");
  for (const key of ["areas", "goals", "agents", "brains", "processes", "problems"]) if (!Array.isArray(value[key])) throw new Error(`Work response has no ${key} array.`);
  if (config.schema && config.schema !== WORK_SCHEMA) throw new Error("Work assets and gateway schema disagree.");
}

/** Reads freshness and identity from Work response headers. */
function transportMetadata(headers) {
  return {
    state: headers.get("x-tangent-work-state") || "stale",
    staleReason: headers.get("x-tangent-work-stale-reason") || "",
    epoch: headers.get("x-tangent-work-epoch") || "",
    revision: Number(headers.get("x-tangent-work-revision") || 0),
    publishedAt: headers.get("x-tangent-work-published-at") || null,
    observedAt: headers.get("x-tangent-work-observed-at") || null,
    gatewayBoot: headers.get("x-tangent-gateway-boot") || "",
    controllerBoot: headers.get("x-tangent-controller-boot") || "",
  };
}

/** Creates the cache identity for one instance and rollout. */
function cacheKey(config) { return `agent-shell.work:${config.instanceId || "unknown"}:${WORK_SCHEMA}:${config.rollout || "v3"}`; }
/** Reads and validates one Work cache entry. */
function readCache(session, config) {
  try {
    const value = JSON.parse(session?.getItem(cacheKey(config)) || "null");
    validateSnapshot(value?.snapshot, config);
    if (value.instanceId !== (config.instanceId || "unknown") || value.schema !== WORK_SCHEMA || value.rollout !== (config.rollout || "v3")) return null;
    return value;
  } catch { return null; }
}
/** Saves one bounded Work cache entry. */
function writeCache(session, config, value) {
  try { session?.setItem(cacheKey(config), JSON.stringify({ ...value, instanceId: config.instanceId || "unknown", schema: WORK_SCHEMA, rollout: config.rollout || "v3" })); } catch {}
}
/** Creates one classified Work HTTP error. */
function httpError(status, body, headers) {
  const error = new Error(body?.error || `Work request failed (${status}).`);
  error.kind = "http";
  error.status = status;
  error.code = body?.code;
  error.retryAfterMs = Math.max(0, Number(headers?.get?.("retry-after") || 0) * 1_000);
  return error;
}
