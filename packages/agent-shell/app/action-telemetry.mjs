import { appendFile } from "node:fs/promises";

export const ACTION_TELEMETRY_SCHEMA = "agent-shell-action.v1";

/** Keeps one untrusted telemetry field short, single-line, and non-sensitive. */
function field(value, limit = 160) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
}

/** Validates the deliberately small browser action envelope. */
export function normalizeActionTelemetry(body, now = () => new Date()) {
  const kind = field(body?.kind, 40);
  const action = field(body?.action, 160);
  if (!kind || !action) return null;
  const durationMs = Number(body?.durationMs);
  const status = Number(body?.status);
  const retryAttempt = Number(body?.retryAttempt);
  const lastSuccessAgeMs = Number(body?.lastSuccessAgeMs);
  const trigger = field(body?.trigger, 40);
  const gatewayBoot = field(body?.gatewayBoot, 128);
  const controllerBoot = field(body?.controllerBoot, 128);
  const operationId = field(body?.operationId, 128);
  const eventStream = field(body?.eventStream, 40);
  return {
    schema: ACTION_TELEMETRY_SCHEMA,
    at: now().toISOString(),
    kind,
    action,
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs: Math.round(durationMs) } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    ...(body?.ok === true || body?.ok === false ? { ok: body.ok } : {}),
    ...(trigger ? { trigger } : {}),
    ...(Number.isInteger(retryAttempt) && retryAttempt >= 0 ? { retryAttempt } : {}),
    ...(Number.isFinite(lastSuccessAgeMs) && lastSuccessAgeMs >= 0 ? { lastSuccessAgeMs: Math.round(lastSuccessAgeMs) } : {}),
    ...(gatewayBoot ? { gatewayBoot } : {}),
    ...(controllerBoot ? { controllerBoot } : {}),
    ...(operationId ? { operationId } : {}),
    ...(eventStream ? { eventStream } : {}),
  };
}

/** Appends one action record. Telemetry failure never fails the UI action. */
export async function recordActionTelemetry(file, body, now) {
  const entry = normalizeActionTelemetry(body, now);
  if (!entry) return false;
  await appendFile(file, `${JSON.stringify(entry)}\n`);
  return true;
}
