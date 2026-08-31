import { appendFile } from "node:fs/promises";

export const ACTION_TELEMETRY_SCHEMA = "agent-shell-action.v1";
const AREA_MAP_ACTIONS = new Set([
  "area_map_world_loaded", "area_map_pointer_down", "area_map_gesture", "area_map_gesture_solved", "area_map_invariant_failed",
  "area_map_projection", "area_map_save", "area_map_save_phase", "area_map_save_conflict", "area_map_retry", "area_map_draft",
  "area_map_shard_loaded", "area_map_tree_reconciled", "area_map_tree_refresh_failed", "area_map_migration_read", "area_map_recovery",
]);

/** Keeps one untrusted telemetry field short, single-line, and non-sensitive. */
function field(value, limit = 160) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
}

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_ID = /^[A-Za-z0-9_-]{16}$/;
const SHARD_REVISION_ID = /^(?:[0-9a-f]{64}|(?:legacy|unreadable):[A-Za-z0-9_-]{16}|missing)$/;

/** Keeps only the machine shape generated for one correlation field. */
function areaMapId(name, value) {
  const next = field(value, 128);
  if (["operationId", "gestureId"].includes(name)) return UUID_ID.test(next) ? next : "";
  if (name === "projectionId") return /^\d{1,16}$/.test(next) ? next : "";
  if (name === "shardRevision") return SHARD_REVISION_ID.test(next) ? next : "";
  return REVISION_ID.test(next) ? next : "";
}

/** Keeps only controlled enum-like diagnostic words. */
function token(value) {
  const next = field(value, 40);
  return /^[a-z][a-z0-9_-]{0,39}$/i.test(next) ? next : "";
}

/** Validates the deliberately small browser action envelope. */
export function normalizeActionTelemetry(body, now = () => new Date()) {
  const kind = field(body?.kind, 40);
  const action = field(body?.action, 160);
  if (!kind || !action) return null;
  if (kind === "area-map" && !AREA_MAP_ACTIONS.has(action)) return null;
  const durationMs = Number(body?.durationMs);
  const usableTimeMs = Number(body?.usableTimeMs);
  const completeTimeMs = Number(body?.completeTimeMs);
  const status = Number(body?.status);
  const retryAttempt = Number(body?.retryAttempt);
  const lastSuccessAgeMs = Number(body?.lastSuccessAgeMs);
  const trigger = field(body?.trigger, 40);
  const gatewayBoot = field(body?.gatewayBoot, 128);
  const controllerBoot = field(body?.controllerBoot, 128);
  const operationId = kind === "area-map" ? areaMapId("operationId", body?.operationId) : field(body?.operationId, 128);
  const gestureId = areaMapId("gestureId", body?.gestureId);
  const projectionId = areaMapId("projectionId", body?.projectionId);
  const worldRevision = areaMapId("worldRevision", body?.worldRevision);
  const treeRevision = areaMapId("treeRevision", body?.treeRevision);
  const shardRevision = areaMapId("shardRevision", body?.shardRevision);
  const eventStream = kind === "area-map" ? "area-map" : field(body?.eventStream, 40);
  const phase = token(body?.phase);
  const priorPhase = token(body?.priorPhase);
  const outcome = token(body?.outcome);
  const failureKind = token(body?.failureKind);
  const gestureKind = token(body?.gestureKind);
  const projectionKind = token(body?.projectionKind);
  const saveState = token(body?.saveState);
  const draftState = token(body?.draftState);
  const shardState = token(body?.shardState);
  const invariantName = token(body?.invariantName);
  const counts = Object.fromEntries(["shardCount", "legacyCards", "boundaries", "provisionalRegions", "recoveredPlacements", "areaCount", "eagerShards", "selectedCount", "affectedCount", "pendingCount", "previewCount", "elementCount", "depth", "bytes", "sampleCount"].flatMap((name) => {
    const value = Number(body?.[name]);
    return Number.isInteger(value) && value >= 0 ? [[name, value]] : [];
  }));
  return {
    schema: ACTION_TELEMETRY_SCHEMA,
    at: now().toISOString(),
    kind,
    action,
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs: Math.round(durationMs) } : {}),
    ...(Number.isFinite(usableTimeMs) && usableTimeMs >= 0 ? { usableTimeMs: Math.round(usableTimeMs) } : {}),
    ...(Number.isFinite(completeTimeMs) && completeTimeMs >= 0 ? { completeTimeMs: Math.round(completeTimeMs) } : {}),
    ...(Number.isInteger(status) && (status === 0 || status >= 100 && status <= 599) ? { status } : {}),
    ...(body?.ok === true || body?.ok === false ? { ok: body.ok } : {}),
    ...(trigger ? { trigger } : {}),
    ...(Number.isInteger(retryAttempt) && retryAttempt >= 0 ? { retryAttempt } : {}),
    ...(Number.isFinite(lastSuccessAgeMs) && lastSuccessAgeMs >= 0 ? { lastSuccessAgeMs: Math.round(lastSuccessAgeMs) } : {}),
    ...(gatewayBoot ? { gatewayBoot } : {}),
    ...(controllerBoot ? { controllerBoot } : {}),
    ...(operationId ? { operationId } : {}),
    ...(gestureId ? { gestureId } : {}),
    ...(projectionId ? { projectionId } : {}),
    ...(worldRevision ? { worldRevision } : {}),
    ...(treeRevision ? { treeRevision } : {}),
    ...(shardRevision ? { shardRevision } : {}),
    ...(eventStream ? { eventStream } : {}),
    ...(phase ? { phase } : {}),
    ...(priorPhase ? { priorPhase } : {}),
    ...(outcome ? { outcome } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(gestureKind ? { gestureKind } : {}),
    ...(projectionKind ? { projectionKind } : {}),
    ...(saveState ? { saveState } : {}),
    ...(draftState ? { draftState } : {}),
    ...(shardState ? { shardState } : {}),
    ...(invariantName ? { invariantName } : {}),
    ...(body?.retryable === true || body?.retryable === false ? { retryable: body.retryable } : {}),
    ...(body?.idempotent === true || body?.idempotent === false ? { idempotent: body.idempotent } : {}),
    ...counts,
  };
}

/** Appends one action record. Telemetry failure never fails the UI action. */
export async function recordActionTelemetry(file, body, now) {
  const entry = normalizeActionTelemetry(body, now);
  if (!entry) return false;
  await appendFile(file, `${JSON.stringify(entry)}\n`);
  return true;
}
