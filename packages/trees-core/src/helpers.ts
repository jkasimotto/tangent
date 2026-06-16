import type { ActorRef, Checkpoint, TreeEntity, TreeEvent, WorkSession } from "@tangent/trees-schema";

/** Documents the resolveEntityRef helper. */
export function resolveEntityRef(entities: TreeEntity[], ref: string): TreeEntity | undefined {
  const exact = entities.find((entity) => entity.id === ref || entity.path === ref);
  if (exact) return exact;
  const candidates = entities.filter((entity) => entity.path.endsWith(`/${ref}`));
  if (candidates.length > 1) throw new Error(`Ambiguous tree path '${ref}': ${candidates.map((entity) => entity.path).join(", ")}`);
  return candidates[0];
}

/** Documents the defaultActor helper. */
export function defaultActor(): ActorRef {
  return { id: "local-user", kind: "user", displayName: "Local user" };
}

/** Documents the defaultSource helper. */
export function defaultSource(kind: TreeEvent["source"]["kind"]): TreeEvent["source"] {
  return { id: kind, kind };
}

/** Documents the now helper. */
export function now(): string {
  return new Date().toISOString();
}

/** Documents the resolveSessionRef helper. */
export function resolveSessionRef(sessions: WorkSession[], entities: TreeEntity[], ref: string): WorkSession | undefined {
  const direct = sessions.find((session) => session.id === ref);
  if (direct) return direct;
  const entity = resolveEntityRef(entities, ref);
  return entity ? [...sessions].reverse().find((session) => session.entityId === entity.id) : undefined;
}

/** Documents the checkpointKindForOutcome helper. */
export function checkpointKindForOutcome(outcome: Checkpoint["outcome"]): Checkpoint["kind"] {
  if (outcome === "paused") return "pause";
  if (outcome === "done") return "done";
  if (outcome === "blocked") return "blocked";
  if (outcome === "abandoned") return "abandoned";
  return "progress";
}
