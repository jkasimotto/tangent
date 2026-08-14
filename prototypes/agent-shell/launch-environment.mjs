// Launch environments: the harness registry and per-area launch defaults.
// Design contract: ~/.tangent/trees/otto/tangent/design-goal-launch-environments.md
// A harness is any exact CLI invocation. A model option pairs a display label
// with exact arguments. The composed command is authoritative: this module
// joins strings and never parses, translates, or rebuilds them.

import { areaAncestors, noteResource } from "./area-agent-command.mjs";

/** Extracts the JSON payload of one fenced ```<tag> block, or null. */
export function fencedBlock(text, tag) {
  const match = String(text ?? "").match(new RegExp("```" + tag.replace(/\./g, "\\.") + "\\s*\\n([\\s\\S]*?)\\n```"));
  return match ? match[1] : null;
}

/**
 * Parses the machine-wide harness registry from the tree-root Document
 * (~/.tangent/trees/harnesses.md). Returns { modelSets, harnesses } on
 * success, { error } when the block is malformed, and null when the file
 * has no registry block at all.
 */
export function parseHarnessRegistry(text) {
  const raw = fencedBlock(text, "tangent.harnesses.v1");
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: `harness registry is not valid JSON: ${error.message}` };
  }
  const harnesses = Array.isArray(parsed.harnesses) ? parsed.harnesses : [];
  const modelSets = parsed.modelSets && typeof parsed.modelSets === "object" ? parsed.modelSets : {};
  for (const harness of harnesses) {
    if (!harness.id || !harness.command) return { error: `harness entries need an id and a command` };
    if (harness.modelSet && !Array.isArray(modelSets[harness.modelSet])) {
      return { error: `harness "${harness.id}" references unknown model set "${harness.modelSet}"` };
    }
  }
  return { modelSets, harnesses };
}

/** Parses one note's tangent.environment.v1 block, or null when absent. */
export function parseEnvironmentBlock(text) {
  const raw = fencedBlock(text, "tangent.environment.v1");
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { error: `environment block is not valid JSON: ${error.message}` };
  }
}

/** The model options one harness offers, in registry order. */
export function harnessModels(registry, harness) {
  if (!harness?.modelSet) return [];
  return registry?.modelSets?.[harness.modelSet] ?? [];
}

/** The display label for one resolved harness and optional model. */
export function launchLabel(harness, model) {
  const harnessLabel = harness.label || harness.id;
  return model ? `${harnessLabel} · ${model.label || model.id}` : harnessLabel;
}

/**
 * Composes the exact command for one { harness, model } launch reference.
 * Never substitutes: an id that does not resolve is an error that names it.
 */
export function resolveLaunch(registry, ref) {
  const harnessId = String(ref?.harness ?? "");
  const harness = (registry?.harnesses ?? []).find((entry) => entry.id === harnessId);
  if (!harness) return { error: `unknown harness "${harnessId}"` };
  const modelId = String(ref?.model ?? "");
  if (!modelId) return { command: harness.command, label: launchLabel(harness), harness: harness.id, model: null };
  const options = harnessModels(registry, harness);
  const model = options.find((entry) => entry.id === modelId);
  if (!model) return { error: `unknown model "${modelId}" for harness "${harness.id}"` };
  return {
    command: `${harness.command} ${model.args}`.trim(),
    label: launchLabel(harness, model),
    harness: harness.id,
    model: model.id,
  };
}

/**
 * Writes one launch reference as a note's durable default: updates the
 * existing environment block in place, or appends a Development environment
 * section with a fresh block. Only the explicit save action calls this.
 */
export function upsertEnvironmentLaunch(text, ref) {
  const existing = fencedBlock(text, "tangent.environment.v1");
  let environment = { version: 1 };
  if (existing !== null) {
    try {
      environment = JSON.parse(existing);
    } catch {
      // A malformed block is replaced by a valid one that keeps only defaults.
    }
  }
  environment.defaults = { ...(environment.defaults ?? {}), launch: ref };
  const block = "```tangent.environment.v1\n" + JSON.stringify(environment, null, 2) + "\n```";
  if (existing !== null) {
    return String(text).replace(/```tangent\.environment\.v1\s*\n[\s\S]*?\n```/, block);
  }
  return `${String(text ?? "").trimEnd()}\n\n## Development environment\n\nThe default launch for new work in this Area.\n\n${block}\n`;
}

/**
 * Resolves the inherited default launch for one Area: the nearest ancestor
 * with an environment default wins, then a legacy `- Agent:` resource line,
 * then the profile fallback (otto/** runs claude-otto, the rest claude).
 */
export async function inheritedLaunch(area, readAreaNote, registry) {
  for (const candidate of areaAncestors(area)) {
    const note = await readAreaNote(candidate);
    const environment = parseEnvironmentBlock(note);
    if (environment?.error) return { error: `${candidate}: ${environment.error}` };
    const ref = environment?.defaults?.launch;
    if (ref) {
      const resolved = resolveLaunch(registry, ref);
      return resolved.error ? { error: `${candidate}: ${resolved.error}` } : { ...resolved, source: candidate };
    }
    const legacy = noteResource(note, "Agent");
    if (legacy) return { command: legacy, label: null, harness: null, model: null, source: candidate };
  }
  const fallback = String(area ?? "").split("/")[0] === "otto" ? "claude-otto" : "claude";
  return { command: fallback, label: null, harness: null, model: null, source: null };
}
