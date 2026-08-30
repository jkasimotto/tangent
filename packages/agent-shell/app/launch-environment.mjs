// Launch environments: the harness registry and per-area launch defaults.
// Design contract: ~/.tangent/trees/otto/tangent/design-goal-launch-environments.md
// A harness is any exact CLI invocation. A model option pairs a display label
// with exact arguments. The composed command is authoritative: this module
// joins strings and never parses, translates, or rebuilds them.

import { areaAncestors } from "./area-agent-command.mjs";

/** Extracts the JSON payload of one fenced ```<tag> block, or null. */
export function fencedBlock(text, tag) {
  const match = String(text ?? "").match(new RegExp("```" + tag.replace(/\./g, "\\.") + "\\s*\\n([\\s\\S]*?)\\n```"));
  return match ? match[1] : null;
}

/** The registry block tags Tangent reads, newest first. Only the newest is written. */
export const HARNESS_REGISTRY_TAG = "tangent.harnesses.v2";
const HARNESS_REGISTRY_TAGS = [HARNESS_REGISTRY_TAG, "tangent.harnesses.v1"];

/**
 * The optional per-harness conversation fields (ADR-0042). `resume` renders
 * the command that reopens one conversation, `sessionIdArg` is appended at
 * launch with a fresh id, and `transcripts` is the folder the harness writes
 * its conversations to. Each is a string template with `{id}` where the
 * conversation id goes and, for `resume`, `{command}` for the launch line.
 */
const CONVERSATION_FIELDS = ["resume", "sessionIdArg", "transcripts"];

/** The first problem with one harness entry's conversation fields, or null. */
function conversationFieldProblem(harness) {
  for (const field of CONVERSATION_FIELDS) {
    if (harness[field] === undefined || harness[field] === null) continue;
    if (typeof harness[field] !== "string") return `harness "${harness.id}" ${field} must be a string`;
    if (field !== "transcripts" && !harness[field].includes("{id}")) return `harness "${harness.id}" ${field} must contain {id}`;
  }
  return null;
}

/**
 * Parses the machine-wide harness registry from the tree-root Document
 * (~/.tangent/trees/harnesses.md). Returns { modelSets, harnesses } on
 * success, { error } when the block is malformed, and null when the file
 * has no registry block at all. A v1 block reads as v2 with no resume fields.
 */
export function parseHarnessRegistry(text) {
  const tag = HARNESS_REGISTRY_TAGS.find((candidate) => fencedBlock(text, candidate) !== null);
  if (!tag) return null;
  const raw = fencedBlock(text, tag);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: `harness registry is not valid JSON: ${error.message}` };
  }
  const harnesses = Array.isArray(parsed.harnesses) ? parsed.harnesses : [];
  const modelSets = parsed.modelSets && typeof parsed.modelSets === "object" ? parsed.modelSets : {};
  const effortSets = parsed.effortSets && typeof parsed.effortSets === "object" ? parsed.effortSets : {};
  for (const harness of harnesses) {
    if (!harness.id || !harness.command) return { error: `harness entries need an id and a command` };
    if (harness.modelSet && !Array.isArray(modelSets[harness.modelSet])) {
      return { error: `harness "${harness.id}" references unknown model set "${harness.modelSet}"` };
    }
    if (harness.effortSet && !Array.isArray(effortSets[harness.effortSet])) {
      return { error: `harness "${harness.id}" references unknown effort set "${harness.effortSet}"` };
    }
    const problem = conversationFieldProblem(harness);
    if (problem) return { error: problem };
  }
  for (const options of Object.values(modelSets)) {
    for (const model of options ?? []) {
      if (model.effortSet && !Array.isArray(effortSets[model.effortSet])) {
        return { error: `model "${model.id || "(unnamed)"}" references unknown effort set "${model.effortSet}"` };
      }
    }
  }
  return { modelSets, effortSets, harnesses };
}

export const ENVIRONMENT_TAG = "tangent.environment.v2";

/** Parses `harness[/model[/effort]]` without guessing omitted axes. */
export function parseLaunch(value) {
  const parts = String(value ?? "").trim().split("/");
  if (!parts[0] || parts.length > 3 || parts.some((part) => !part.trim())) return null;
  return { harness: parts[0], ...(parts[1] ? { model: parts[1] } : {}), ...(parts[2] ? { effort: parts[2] } : {}) };
}

/** Parses one note's Area launch policy, or null when absent. */
export function parseEnvironmentBlock(text) {
  if (fencedBlock(text, "tangent.environment.v1") !== null) {
    return { error: "tangent.environment.v1 is retired; run tangent shell migrate-launch-policy" };
  }
  const raw = fencedBlock(text, ENVIRONMENT_TAG);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 2 || !Array.isArray(parsed.allow)) return { error: "environment policy needs version 2 and an allow list" };
    const allow = parsed.allow.map(parseLaunch);
    if (allow.some((entry) => !entry)) return { error: "each allowed launch must be harness[/model[/effort]]" };
    const aliases = parsed.aliases ?? {};
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases) || Object.entries(aliases).some(([from, to]) => !from.trim() || typeof to !== "string" || !to.trim() || to.includes("/"))) {
      return { error: "environment aliases must map harness ids to harness ids" };
    }
    return { ...parsed, allow, aliases };
  } catch (error) {
    return { error: `environment block is not valid JSON: ${error.message}` };
  }
}

/** True when a concrete launch matches one policy pattern. */
export function launchMatches(pattern, ref) {
  return pattern.harness === ref.harness
    && (!pattern.model || pattern.model === ref.model)
    && (!pattern.effort || pattern.effort === ref.effort);
}

/** Expands the registry into concrete launches in registry order. */
export function registeredLaunches(registry) {
  const launches = [];
  for (const harness of registry?.harnesses ?? []) {
    const models = harnessModels(registry, harness);
    if (!models.length) {
      const efforts = harnessEfforts(registry, harness);
      if (efforts.length) for (const effort of efforts) launches.push(resolveLaunch(registry, { harness: harness.id, effort: effort.id }));
      else launches.push(resolveLaunch(registry, { harness: harness.id }));
      continue;
    }
    for (const model of models) {
      const efforts = modelEfforts(registry, harness, model);
      if (efforts.length) for (const effort of efforts) launches.push(resolveLaunch(registry, { harness: harness.id, model: model.id, effort: effort.id }));
      else launches.push(resolveLaunch(registry, { harness: harness.id, model: model.id }));
    }
  }
  return launches;
}

/** Resolves the intersection of every policy declared on an Area chain. */
export async function areaLaunchPolicy(area, readAreaNote, registry) {
  const declarations = [];
  for (const candidate of areaAncestors(area)) {
    const environment = parseEnvironmentBlock(await readAreaNote(candidate));
    if (environment?.error) return { error: `${candidate}: ${environment.error}` };
    if (environment) declarations.push({ area: candidate, allow: environment.allow, aliases: environment.aliases });
  }
  const all = registeredLaunches(registry);
  const launches = declarations.length
    ? all.filter((launch) => declarations.every((entry) => entry.allow.some((pattern) => launchMatches(pattern, launch))))
    : all;
  if (declarations.length) launches.sort((left, right) => {
    const patterns = declarations[0].allow;
    return patterns.findIndex((pattern) => launchMatches(pattern, left)) - patterns.findIndex((pattern) => launchMatches(pattern, right));
  });
  return {
    area,
    allow: declarations[0]?.allow ?? [],
    declaredBy: declarations.map((entry) => entry.area),
    aliases: Object.assign({}, ...declarations.slice().reverse().map((entry) => entry.aliases)),
    unrestricted: declarations.length === 0,
    launches,
  };
}

/** Rewrites a legacy harness id through one Area policy without changing model or effort. */
export function applyLaunchAliases(ref, aliases = {}) {
  let harness = String(ref?.harness ?? "");
  const seen = new Set();
  while (aliases[harness]) {
    if (seen.has(harness)) return { error: `launch alias cycle at "${harness}"` };
    seen.add(harness);
    harness = aliases[harness];
  }
  return { ...ref, harness };
}

/** The model options one harness offers, in registry order. */
export function harnessModels(registry, harness) {
  if (!harness?.modelSet) return [];
  return registry?.modelSets?.[harness.modelSet] ?? [];
}

/** The effort options one harness offers, in registry order. */
export function harnessEfforts(registry, harness) {
  if (!harness?.effortSet) return [];
  return registry?.effortSets?.[harness.effortSet] ?? [];
}

/** The effort options for one model, falling back to its harness for v1 registries. */
export function modelEfforts(registry, harness, model = null) {
  const set = model?.effortSet || harness?.effortSet;
  return set ? registry?.effortSets?.[set] ?? [] : [];
}

/** The display label for one resolved harness, optional model, and optional effort. */
export function launchLabel(harness, model, effort) {
  return [harness.label || harness.id, model ? model.label || model.id : "", effort ? effort.label || effort.id : ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The id form of one launch, `harness/model/effort`, with empty parts dropped.
 * The Work rows print this and not the display label: the harness `claude-otto`
 * carries the label `Claude · Otto`, so a label reads `Claude · Otto · Opus 5 ·
 * Medium` and no reader can tell which part is the model.
 */
export function launchRef(ref) {
  return [ref?.harness, ref?.model, ref?.effort].filter(Boolean).join("/");
}

/**
 * Composes the exact command for one { harness, model?, effort? } launch
 * reference: harness command, then model args, then effort args. Never
 * substitutes: an id that does not resolve is an error that names it.
 */
export function resolveLaunch(registry, ref) {
  const harnessId = String(ref?.harness ?? "");
  const harness = (registry?.harnesses ?? []).find((entry) => entry.id === harnessId);
  if (!harness) return { error: `unknown harness "${harnessId}"` };
  const modelId = String(ref?.model ?? "");
  let model = null;
  if (modelId) {
    model = harnessModels(registry, harness).find((entry) => entry.id === modelId) ?? null;
    if (!model) return { error: `unknown model "${modelId}" for harness "${harness.id}"` };
  }
  const effortId = String(ref?.effort ?? "");
  let effort = null;
  if (effortId) {
    effort = modelEfforts(registry, harness, model).find((entry) => entry.id === effortId) ?? null;
    if (!effort) return { error: `unknown effort "${effortId}" for harness "${harness.id}"` };
  }
  return {
    command: [harness.command, model?.args, effort?.args].filter((part) => part && String(part).trim()).join(" ").trim(),
    label: launchLabel(harness, model, effort),
    harness: harness.id,
    model: model ? model.id : null,
    effort: effort ? effort.id : null,
  };
}

/**
 * Rejects a registry that would break launches before it is written:
 * missing ids or commands, duplicate ids, and unknown model-set references.
 * Returns the first problem as a string, or null for a valid registry.
 */
export function validateHarnessRegistry(registry) {
  const harnesses = Array.isArray(registry?.harnesses) ? registry.harnesses : [];
  const modelSets = registry?.modelSets && typeof registry.modelSets === "object" ? registry.modelSets : {};
  const effortSets = registry?.effortSets && typeof registry.effortSets === "object" ? registry.effortSets : {};
  const seen = new Set();
  for (const harness of harnesses) {
    if (!harness.id || !harness.command) return "every harness needs an id and a command";
    if (seen.has(harness.id)) return `duplicate harness id "${harness.id}"`;
    seen.add(harness.id);
    if (harness.modelSet && !Array.isArray(modelSets[harness.modelSet])) {
      return `harness "${harness.id}" references unknown model set "${harness.modelSet}"`;
    }
    if (harness.effortSet && !Array.isArray(effortSets[harness.effortSet])) {
      return `harness "${harness.id}" references unknown effort set "${harness.effortSet}"`;
    }
    const problem = conversationFieldProblem(harness);
    if (problem) return problem;
  }
  for (const [name, options] of Object.entries(modelSets)) {
    const ids = new Set();
    for (const option of options ?? []) {
      if (!option.id) return `a model option in the "${name}" set has no id`;
      if (ids.has(option.id)) return `duplicate model id "${option.id}" in the "${name}" set`;
      ids.add(option.id);
      if (option.effortSet && !Array.isArray(effortSets[option.effortSet])) {
        return `model "${option.id}" references unknown effort set "${option.effortSet}"`;
      }
    }
  }
  for (const [name, options] of Object.entries(effortSets)) {
    const ids = new Set();
    for (const option of options ?? []) {
      if (!option.id) return `an effort option in the "${name}" set has no id`;
      if (ids.has(option.id)) return `duplicate effort id "${option.id}" in the "${name}" set`;
      ids.add(option.id);
    }
  }
  return null;
}

/**
 * Writes the registry back into the harnesses Document: replaces the
 * existing fenced block, or appends one to a new or blockless file.
 */
export function upsertHarnessRegistry(text, registry) {
  const block = "```" + HARNESS_REGISTRY_TAG + "\n" + JSON.stringify(registry, null, 2) + "\n```";
  const existing = HARNESS_REGISTRY_TAGS.find((tag) => fencedBlock(text, tag) !== null);
  if (existing) {
    return String(text).replace(new RegExp("```" + existing.replace(/\./g, "\\.") + "\\s*\\n[\\s\\S]*?\\n```"), block);
  }
  const base = String(text ?? "").trim() || "# Harnesses\n\nThis Document is the machine-wide harness registry. Every Area inherits it. Edit it here or through the Agent Shell harness editor.";
  return `${base}\n\n${block}\n`;
}

/**
 * Writes one launch reference as a note's durable default: updates the
 * existing environment block in place, or appends a Development environment
 * section with a fresh block. Only the explicit save action calls this.
 */
export function upsertEnvironmentLaunch(text, ref, kind = "launch") {
  return updateEnvironmentDefault(text, { kind, mode: "launch", launch: ref });
}

/** Writes or removes one Area's local v2 policy declaration. */
export function updateEnvironmentPolicy(text, allow) {
  const current = String(text ?? "");
  if (fencedBlock(current, "tangent.environment.v1") !== null) throw new Error("tangent.environment.v1 is retired; run tangent shell migrate-launch-policy");
  const existing = fencedBlock(current, ENVIRONMENT_TAG);
  const refs = (allow ?? []).map((entry) => typeof entry === "string" ? entry : launchRef(entry));
  if (!refs.length) return existing === null ? current : current.replace(/```tangent\.environment\.v2\s*\n[\s\S]*?\n```\s*/, "");
  let environment = {};
  if (existing !== null) {
    try { environment = JSON.parse(existing); }
    catch (error) { throw new Error(`environment block is not valid JSON: ${error.message}`); }
  }
  const block = `\`\`\`${ENVIRONMENT_TAG}\n${JSON.stringify({ ...environment, version: 2, allow: refs }, null, 2)}\n\`\`\``;
  if (existing !== null) return current.replace(/```tangent\.environment\.v2\s*\n[\s\S]*?\n```/, block);
  return `${current.trimEnd()}\n\n## Development environment\n\nAllowed launches in this Area subtree.\n\n${block}\n`;
}

/** Converts one legacy default block into a v2 policy or inherited policy. */
export function migrateEnvironmentV1(text, allow = []) {
  const current = String(text ?? "");
  const raw = fencedBlock(current, "tangent.environment.v1");
  let defaults = null;
  if (raw !== null) {
    try { defaults = JSON.parse(raw).defaults ?? {}; }
    catch (error) { throw new Error(`environment block is not valid JSON: ${error.message}`); }
  }
  const withoutLegacy = raw === null ? current : current.replace(/```tangent\.environment\.v1\s*\n[\s\S]*?\n```\s*/, "");
  return { text: updateEnvironmentPolicy(withoutLegacy, allow), defaults };
}

/**
 * Updates one Area default without changing the other default or environment
 * fields. Inherit removes the local key. A Brain can explicitly follow Work.
 */
export function updateEnvironmentDefault(text, { kind = "launch", mode = "launch", launch = null } = {}) {
  const existing = fencedBlock(text, "tangent.environment.v1");
  let environment = { version: 1 };
  if (existing !== null) {
    try {
      environment = JSON.parse(existing);
    } catch (error) {
      throw new Error(`environment block is not valid JSON: ${error.message}`);
    }
  }
  const defaults = { ...(environment.defaults ?? {}) };
  if (mode === "inherit") delete defaults[kind];
  else if (mode === "work" && kind === "brain") defaults.brain = "work";
  else if (mode === "launch") defaults[kind] = launch;
  else throw new Error(`invalid ${kind} default mode "${mode}"`);
  environment.defaults = defaults;
  const block = "```tangent.environment.v1\n" + JSON.stringify(environment, null, 2) + "\n```";
  if (existing !== null) {
    return String(text).replace(/```tangent\.environment\.v1\s*\n[\s\S]*?\n```/, block);
  }
  if (mode === "inherit") return String(text ?? "");
  return `${String(text ?? "").trimEnd()}\n\n## Development environment\n\nThe default launch for new work in this Area.\n\n${block}\n`;
}

/** Resolves the nearest explicit brain launch, without applying a machine fallback. */
export async function inheritedBrainLaunch(area, readAreaNote, registry) {
  for (const candidate of areaAncestors(area)) {
    const note = await readAreaNote(candidate);
    const environment = parseEnvironmentBlock(note);
    if (environment?.error) return { error: `${candidate}: ${environment.error}` };
    const ref = environment?.defaults?.brain;
    if (!ref) continue;
    if (ref === "work") {
      const work = await inheritedLaunch(area, readAreaNote, registry);
      if (!work) return { error: `${candidate}: brain follows Work, but ${area} has no declared work launch` };
      if (work.error) return work;
      return { ...work, source: candidate, workSource: work.source, via: "work" };
    }
    const resolved = resolveLaunch(registry, ref);
    return resolved.error ? { error: `${candidate}: ${resolved.error}` } : { ...resolved, source: candidate, via: "brain" };
  }
  return null;
}

/**
 * Resolves the declared default launch for one Area: the nearest ancestor
 * with an environment default wins. Returns the declaration, an error that
 * names the broken Area, or null when no ancestor declares one. It never
 * substitutes a command of its own, so nothing in Tangent can start a worker
 * on a harness that no Area named.
 */
export async function inheritedLaunch(area, readAreaNote, registry) {
  for (const candidate of areaAncestors(area)) {
    const note = await readAreaNote(candidate);
    const environment = parseEnvironmentBlock(note);
    if (environment?.error) return { error: `${candidate}: ${environment.error}` };
    const ref = environment?.defaults?.launch;
    if (!ref) continue;
    const resolved = resolveLaunch(registry, ref);
    return resolved.error ? { error: `${candidate}: ${resolved.error}` } : { ...resolved, source: candidate };
  }
  return null;
}
