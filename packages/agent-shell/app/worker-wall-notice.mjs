import { createHash } from "node:crypto";

/** Builds a brain notice only from a verified, terminal screen wall. */
export function workerWallNotice(record, step, observation) {
  const wall = observation?.wall;
  if (!wall?.pattern || !wall.harness || wall.source !== "screen" || observation.activity?.source !== "none") return null;
  const source = createHash("sha256").update(`${wall.harness}\0${wall.pattern}\0${wall.kind}\0${wall.model ?? ""}\0${wall.text}`).digest("hex").slice(0, 20);
  const observedAt = new Date(wall.since ?? observation.at).toISOString();
  return {
    sourceId: `worker-wall:${record.goal}:${step.id}:${source}`,
    text: `Goal ${record.slug}: assignment ${step.index} hit a verified ${wall.kind} wall in ${wall.harness}: "${wall.text}" (pattern ${wall.pattern}, screen, ${observedAt}). Replace the agent on another model, or end the assignment.`,
  };
}
