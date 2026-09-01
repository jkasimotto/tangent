import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { WORK_HARD_LIMIT_BYTES, WORK_SCHEMA, WORK_STORE_SCHEMA, validateWorkCandidate, validateWorkSnapshot, workHash, workSemanticHash } from "./work-model.mjs";

/** Creates the gateway-owned durable Work store. */
export function createWorkStore({ root, instanceId, now = () => new Date(), fs = { mkdir, open, readFile, rename }, hardLimit = WORK_HARD_LIMIT_BYTES, metric = () => {}, swap = (next) => next, fatal = (error) => { throw error; } }) {
  const storeKey = workHash(instanceId);
  const file = path.join(root, `${storeKey}.json`);
  let snapshot = null;
  let freshness = { state: "stale", reason: "not-loaded", observedAt: null, controllerBoot: "" };
  let lastRejection = null;

  /** Loads and validates exact persisted response bytes before public listen. */
  async function load() {
    const startedAt = performance.now();
    try {
      const envelope = JSON.parse(await fs.readFile(file, "utf8"));
      const validated = validateEnvelope(envelope, { instanceId, hardLimit });
      if (!validated.ok) throw Object.assign(new Error(validated.code), { code: validated.code });
      snapshot = Object.freeze({
        body: validated.body,
        value: validated.value,
        epoch: envelope.epoch,
        revision: envelope.revision,
        publishedAt: envelope.publishedAt,
        semanticHash: envelope.semanticHash,
        etag: etag(envelope.epoch, envelope.revision, envelope.bodyHash),
      });
      freshness = { state: "stale", reason: "controller-reconciliation", observedAt: null, controllerBoot: "" };
      metric("work_store_load_total", 1, { result: "loaded" });
      metric("work_store_write_ms", performance.now() - startedAt, { result: "load" });
      return { state: "loaded", snapshot };
    } catch (error) {
      if (error.code === "ENOENT") {
        metric("work_store_load_total", 1, { result: "missing" });
        return { state: "missing", snapshot: null };
      }
      const quarantine = `${file}.corrupt-${stamp(now())}`;
      try { await fs.rename(file, quarantine); } catch {}
      metric("work_store_load_total", 1, { result: "corrupt" });
      return { state: "corrupt", code: error.code ?? "work-store-corrupt", quarantine, snapshot: null };
    }
  }

  /** Persists one changed candidate before it becomes the public buffer. */
  async function publish({ candidate, semanticHash, controllerBoot }) {
    const validation = validateWorkCandidate(candidate, { hardLimit });
    if (!validation.ok) return reject(validation.code, validation.bytes ?? Buffer.byteLength(JSON.stringify(candidate)));
    const actualHash = workSemanticHash(candidate);
    if (semanticHash !== actualHash) return reject("candidate-hash-mismatch", validation.bytes);
    const observedAt = now().toISOString();
    if (snapshot?.semanticHash === semanticHash) {
      freshness = freshnessFromCandidate(candidate, { state: "current", reason: "", observedAt, controllerBoot });
      metric("work_publish_total", 1, { result: "equal" });
      return acknowledgement(false);
    }

    const epoch = snapshot?.epoch ?? randomUUID();
    const revision = (snapshot?.revision ?? 0) + 1;
    const publishedAt = observedAt;
    const value = { ...candidate, epoch, revision, publishedAt };
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > hardLimit) return reject("candidate-too-large", body.length);
    const bodyHash = workHash(body.toString("base64"));
    const envelope = {
      schema: WORK_STORE_SCHEMA,
      instanceId,
      epoch,
      revision,
      publishedAt,
      semanticHash,
      bodyHash,
      body: body.toString("base64"),
    };
    const startedAt = performance.now();
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      await fs.mkdir(root, { recursive: true });
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
        await handle.sync();
      } finally { await handle.close(); }
      await fs.rename(temporary, file);
      renamed = true;
      const directory = await fs.open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      const next = Object.freeze({ body, value, epoch, revision, publishedAt, semanticHash, etag: etag(epoch, revision, bodyHash) });
      snapshot = swap(next);
      freshness = freshnessFromCandidate(candidate, { state: "current", reason: "", observedAt, controllerBoot });
      lastRejection = null;
      metric("work_store_write_ms", performance.now() - startedAt, { result: "ok" });
      metric("work_store_revision", revision);
      metric("work_store_bytes", body.length);
      metric("work_publish_total", 1, { result: "changed" });
      return acknowledgement(true);
    } catch (error) {
      metric("work_store_write_ms", performance.now() - startedAt, { result: "error" });
      if (renamed) {
        error.code = "work-store-fatal-after-rename";
        return fatal(error);
      }
      return reject("store-write-failed", body.length, error);
    }
  }

  /** Rejects a candidate while preserving the current buffer. */
  function reject(code, bytes, error = null) {
    lastRejection = { code, bytes, at: now().toISOString() };
    freshness = { ...freshness, state: "stale", reason: "candidate-rejected" };
    metric("work_candidate_rejected_total", 1, { code });
    return { ok: false, code, bytes, error: error ? String(error.message ?? error) : null };
  }

  /** Returns the identity of the current durable snapshot. */
  function acknowledgement(changed) {
    return { ok: true, changed, epoch: snapshot.epoch, revision: snapshot.revision, semanticHash: snapshot.semanticHash };
  }

  /** Marks transport freshness stale without replacing facts. */
  function markStale(reason, controllerBoot = freshness.controllerBoot) {
    if (!snapshot) return;
    freshness = { ...freshness, state: "stale", reason, controllerBoot };
  }

  /** Marks the current buffer reconciled with one controller. */
  function markCurrent({ controllerBoot = freshness.controllerBoot, observedAt = now().toISOString() } = {}) {
    if (!snapshot) return;
    const degraded = Object.values(snapshot.value.fence).some((source) => source.condition === "degraded");
    freshness = { state: degraded ? "degraded" : "current", reason: degraded ? "source-degraded" : "", observedAt, controllerBoot };
  }

  /** Returns the immutable public snapshot. */
  function current() { return snapshot; }
  /** Returns a copy of mutable transport freshness. */
  function metadata() { return { ...freshness }; }
  /** Returns bounded Work store health. */
  function health() {
    return {
      state: snapshot ? freshness.state : "not-ready",
      epoch: snapshot?.epoch ?? null,
      revision: snapshot?.revision ?? 0,
      bytes: snapshot?.body.length ?? 0,
      publishedAt: snapshot?.publishedAt ?? null,
      observedAt: freshness.observedAt,
      ageMs: snapshot ? Math.max(0, now().getTime() - Date.parse(snapshot.publishedAt)) : null,
      staleReason: freshness.reason,
      sourceConditions: snapshot ? Object.fromEntries(Object.entries(snapshot.value.fence).map(([domain, source]) => [domain, source.condition])) : {},
      lastRejection,
    };
  }

  return { file, load, publish, current, metadata, health, markStale, markCurrent };
}

/** Returns all public freshness headers for both 200 and 304 responses. */
export function workResponseHeaders(store, { gatewayBoot }) {
  const snapshot = store.current();
  const metadata = store.metadata();
  if (!snapshot) return {};
  return {
    etag: snapshot.etag,
    "cache-control": "no-cache",
    "x-tangent-work-epoch": snapshot.epoch,
    "x-tangent-work-revision": String(snapshot.revision),
    "x-tangent-work-state": metadata.state,
    "x-tangent-work-stale-reason": metadata.reason,
    "x-tangent-work-published-at": snapshot.publishedAt,
    "x-tangent-work-observed-at": metadata.observedAt ?? "",
    "x-tangent-gateway-boot": gatewayBoot,
    "x-tangent-controller-boot": metadata.controllerBoot ?? "",
  };
}

/** Validates a complete persisted envelope and its exact body bytes. */
function validateEnvelope(envelope, { instanceId, hardLimit }) {
  if (!envelope || envelope.schema !== WORK_STORE_SCHEMA) return { ok: false, code: "store-schema" };
  if (envelope.instanceId !== instanceId) return { ok: false, code: "store-instance" };
  const body = Buffer.from(String(envelope.body ?? ""), "base64");
  if (!body.length || body.length > hardLimit) return { ok: false, code: "store-body-size" };
  if (workHash(body.toString("base64")) !== envelope.bodyHash) return { ok: false, code: "store-body-hash" };
  let value;
  try { value = JSON.parse(body.toString("utf8")); } catch { return { ok: false, code: "store-body-json" }; }
  const validation = validateWorkSnapshot(value, { hardLimit });
  if (!validation.ok) return { ok: false, code: validation.code };
  if (value.schema !== WORK_SCHEMA || value.epoch !== envelope.epoch || value.revision !== envelope.revision || value.publishedAt !== envelope.publishedAt) return { ok: false, code: "store-envelope-mismatch" };
  const { epoch: _epoch, revision: _revision, publishedAt: _publishedAt, ...candidate } = value;
  if (workSemanticHash(candidate) !== envelope.semanticHash) return { ok: false, code: "store-semantic-hash" };
  return { ok: true, body, value };
}

/** Derives transport freshness from source conditions. */
function freshnessFromCandidate(candidate, base) {
  const degraded = Object.values(candidate.fence).some((source) => source.condition === "degraded");
  return degraded ? { ...base, state: "degraded", reason: "source-degraded" } : base;
}

/** Creates the strong identity tag for one immutable buffer. */
function etag(epoch, revision, bodyHash) { return `"work-${epoch}-${revision}-${bodyHash.slice(0, 12)}"`; }
/** Creates a file-safe quarantine timestamp. */
function stamp(value) { return value.toISOString().replace(/[:.]/g, "-"); }
