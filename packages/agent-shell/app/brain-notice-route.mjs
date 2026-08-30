import { areaAncestors } from "./area-agent-command.mjs";
import { currentGeneration } from "./brain-record.mjs";

/** Exact Area first, then physical ancestors, then the virtual root brain. */
export function brainRouteAreas(sourceArea) {
  const physical = areaAncestors(sourceArea);
  return [...physical, ...(physical.includes("@root") ? [] : ["@root"])];
}

/**
 * The immutable identity which must still be true when a notice is delivered.
 * Session names alone are reusable and therefore are not a delivery fence.
 */
export function activeBrainRoute(record, inspected, instanceId) {
  const generation = currentGeneration(record);
  if (!record || record.status !== "active" || !generation) return null;
  if (!record.session || record.currentAttemptId !== record.session) return null;
  if (generation.session !== record.session || generation.generation !== record.generation) return null;
  if (record.instanceId !== instanceId || generation.instanceId !== instanceId) return null;
  if (!inspected || inspected.state !== "live" || inspected.instanceId !== instanceId) return null;
  if (!generation.target || inspected.target !== generation.target) return null;
  if (inspected.area !== record.area || inspected.kind !== "brain") return null;
  if (Number(inspected.generation) !== Number(generation.generation)) return null;
  return {
    role: "brain",
    sourceArea: null,
    brainArea: record.area,
    session: record.session,
    generation: generation.generation,
    instanceId,
    target: generation.target,
    brain: record,
  };
}
