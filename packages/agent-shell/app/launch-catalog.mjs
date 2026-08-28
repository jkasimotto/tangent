import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  areaLaunchPolicy, harnessEfforts, harnessModels, launchMatches, launchRef, modelEfforts, parseEnvironmentBlock, parseHarnessRegistry, parseLaunch, resolveLaunch, updateEnvironmentPolicy, upsertHarnessRegistry,
  validateHarnessRegistry,
} from "./launch-environment.mjs";

/** Owns launch registry reads and Area/per-run launch resolution. */
export function createLaunchCatalog({ root, readAreaNote, repository = null, commit = null, stage = null, areaFile = null, emptyAreaNote = null, memory = null, listAreas = null }) {
  /** Reads the machine-wide registry; an absent block is an empty registry. */
  async function registry() {
    const text = await readFile(path.join(root, "harnesses.md"), "utf8").catch(() => "");
    const parsed = parseHarnessRegistry(text) ?? { modelSets: {}, effortSets: {}, harnesses: [] };
    if (parsed.error) return parsed;
    const error = validateHarnessRegistry(parsed);
    return error ? { error: `harness registry is invalid: ${error}` } : parsed;
  }

  /** Resolves the effective inherited policy for one Area. */
  async function policyFor(area) {
    const current = await registry();
    return current.error ? current : areaLaunchPolicy(area, readAreaNote, current);
  }

  /** Resolves a registered launch and checks it against one Area. */
  async function allowed(area, ref) {
    const policy = await policyFor(area);
    if (policy.error) return policy;
    const resolved = resolveLaunch(await registry(), ref);
    if (resolved.error) return resolved;
    if (policy.launches.some((entry) => launchRef(entry) === launchRef(resolved))) return { ...resolved, policy };
    return { error: `launch ${launchRef(ref)} is not allowed in ${area}`, code: "launch-not-allowed", launch: launchRef(ref), area, allowed: policy.allow.map(launchRef) };
  }

  /** Finds the nearest registered and allowed remembered launch. */
  async function remembered(area, kind = "work") {
    const policy = await policyFor(area);
    if (policy.error) return policy;
    const saved = await memory?.read?.() ?? {};
    const ancestors = String(area).split("/").map((_, index, parts) => parts.slice(0, parts.length - index).join("/"));
    for (const source of ancestors) {
      const ref = saved[source]?.[kind];
      if (ref && policy.launches.some((entry) => launchRef(entry) === launchRef(ref))) return { ...ref, source };
    }
    const fallback = policy.unrestricted ? null : policy.launches[0] ?? null;
    return fallback ? { harness: fallback.harness, ...(fallback.model ? { model: fallback.model } : {}), ...(fallback.effort ? { effort: fallback.effort } : {}), source: null } : null;
  }

  /** Stores one successful launch after a final policy check. */
  async function saveMemory(area, kind, ref) {
    const accepted = await allowed(area, ref);
    if (accepted.error) return accepted;
    await memory?.write?.(area, kind, { harness: accepted.harness, ...(accepted.model ? { model: accepted.model } : {}), ...(accepted.effort ? { effort: accepted.effort } : {}) });
    return accepted;
  }

  /** Resolves the remembered or first allowed launch for one Area. */
  async function forArea(area) {
    const ref = await remembered(area, "work");
    if (ref?.error) return ref;
    return ref ? allowed(area, ref) : null;
  }

  /** Returns the exact command for one Area or throws its declaration error. */
  async function commandForArea(area) {
    const launch = await forArea(area);
    if (!launch) throw new Error(`${area}: no work launch is declared`);
    if (launch.error) throw new Error(launch.error);
    return launch.command;
  }

  /** Resolves the remembered or first allowed brain launch. */
  async function forBrain(area) {
    const ref = await remembered(area, "brain");
    if (ref?.error) return ref;
    return ref ? allowed(area, ref) : { error: `${area}: no remembered or allowed brain launch` };
  }

  /** Returns the defaults declared directly on one Area. */
  async function declarations(area) {
    if (!area) return { work: { mode: "inherit" }, brain: { mode: "inherit" } };
    const environment = parseEnvironmentBlock(await readAreaNote(area));
    if (environment?.error) return { error: `${area}: ${environment.error}` };
    return { allow: environment?.allow ?? [] };
  }

  /** Returns one registry snapshot with exact commands and the requested Area defaults. */
  async function options(area = "", kind = "launch") {
    const current = await registry();
    if (current.error) return current;
    /** Composes one accepted catalog choice from the validated snapshot. */
    const launchFor = (harness, model = null, effort = null) => resolveLaunch(current, {
      harness: harness.id,
      ...(model ? { model: model.id } : {}),
      ...(effort ? { effort: effort.id } : {}),
    });
    const policy = area ? await policyFor(area) : { unrestricted: true, launches: [] };
    if (policy.error) return policy;
    /** True when the requested catalog entry is in the filtered policy. */
    const accepted = (ref) => !area || policy.launches.some((entry) => launchRef(entry) === launchRef(ref));
    const harnesses = current.harnesses.map((harness) => ({
      id: harness.id,
      label: harness.label || harness.id,
      command: harness.command,
      models: harnessModels(current, harness).map((model) => ({
        id: model.id,
        label: model.label || model.id,
        args: model.args,
        command: launchFor(harness, model).command,
        efforts: modelEfforts(current, harness, model).map((effort) => ({
          id: effort.id,
          label: effort.label || effort.id,
          args: effort.args,
          command: launchFor(harness, model, effort).command,
        })).filter((effort) => accepted({ harness: harness.id, model: model.id, effort: effort.id })),
      })).filter((model) => model.efforts.length ? true : accepted({ harness: harness.id, model: model.id })),
      efforts: harnessEfforts(current, harness).map((effort) => ({
        id: effort.id,
        label: effort.label || effort.id,
        args: effort.args,
        command: launchFor(harness, null, effort).command,
      })).filter((effort) => accepted({ harness: harness.id, effort: effort.id })),
    })).filter((harness) => harness.models.length || harness.efforts.length || accepted({ harness: harness.id }));
    const local = area ? await declarations(area) : null;
    if (local?.error) return local;
    const rememberedChoice = area ? await remembered(area, kind === "brain" ? "brain" : "work") : null;
    return {
      source: path.join(root, "harnesses.md"),
      ...(area ? { area } : {}),
      harnesses,
      ...(kind === "all" ? { declarations: local, remembered: rememberedChoice, brainRemembered: await remembered(area, "brain") } : { remembered: rememberedChoice }),
      policy: { allow: policy.allow ?? [], declaredBy: policy.declaredBy ?? [], unrestricted: policy.unrestricted },
    };
  }

  /** Resolves an edited command or explicit registry choice from one request. */
  async function requested(input) {
    if (typeof input.command === "string" && input.command.trim()) {
      return { command: input.command.trim(), label: "Edited command" };
    }
    if (input.choice && typeof input.choice === "object") {
      const current = await registry();
      if (current.error) return { error: current.error };
      return resolveLaunch(current, input.choice);
    }
    return { command: "", label: "" };
  }

  /** Validates and writes one Area's local allow patterns. */
  async function savePolicy(area, allow) {
    if (!repository || !commit || !areaFile || !emptyAreaNote) throw new Error("launch catalog is read-only");
    if (!area) return { error: "an area is required", code: "invalid-area" };
    const current = await registry();
    const patterns = (allow ?? []).map(parseLaunch);
    if (patterns.some((entry) => !entry)) return { error: "each allowed launch must be harness[/model[/effort]]", code: "pattern-invalid" };
    const concrete = (await areaLaunchPolicy(area, async () => "", current)).launches;
    for (const pattern of patterns) if (!concrete.some((launch) => launchMatches(pattern, launch))) {
      return { error: `pattern ${launchRef(pattern)} matches no registered launch`, code: "pattern-invalid" };
    }
    const parent = area.includes("/") ? area.slice(0, area.lastIndexOf("/")) : "";
    if (parent) {
      const parentPolicy = await policyFor(parent);
      if (parentPolicy.error) return parentPolicy;
      const proposed = concrete.filter((launch) => patterns.some((pattern) => launchMatches(pattern, launch)));
      if (!parentPolicy.unrestricted && proposed.some((launch) => !parentPolicy.launches.some((entry) => launchRef(entry) === launchRef(launch)))) return { error: `${area} policy widens ${parent}`, code: "policy-widens" };
    }
    const file = areaFile(area);
    const text = await readFile(path.join(root, file), "utf8").catch(() => emptyAreaNote(area));
    let next;
    try { next = updateEnvironmentPolicy(text, patterns); } catch (error) { return { error: error.message }; }
    /** Reads the proposed note at the target and durable notes elsewhere. */
    const nextReader = (candidate) => candidate === area ? next : readAreaNote(candidate);
    for (const descendant of await listAreas?.() ?? [area]) {
      if (descendant !== area && !descendant.startsWith(`${area}/`)) continue;
      const proposed = await areaLaunchPolicy(descendant, nextReader, current);
      if (proposed.error) return proposed;
      if (!proposed.launches.length) return { error: `policy would leave ${descendant} with no allowed launch`, code: "policy-empties-child", area: descendant };
    }
    await repository.writeMarkdown(file, next);
    await stage?.(file);
    await commit([file], `update: ${area} allowed launches ${patterns.map(launchRef).join(", ") || "inherit"}`, area, null);
    return { policy: await areaLaunchPolicy(area, nextReader, current) };
  }

  /** Validates and writes the complete machine registry through the vault owner. */
  async function saveRegistry(input) {
    if (!repository || !commit) throw new Error("launch catalog is read-only");
    const next = {
      version: 2,
      modelSets: input.modelSets ?? {},
      ...(input.effortSets && Object.keys(input.effortSets).length ? { effortSets: input.effortSets } : {}),
      harnesses: input.harnesses ?? [],
    };
    const problem = validateHarnessRegistry(next);
    if (problem) return { error: problem };
    const text = await readFile(path.join(root, "harnesses.md"), "utf8").catch(() => "");
    await repository.writeMarkdown("harnesses.md", upsertHarnessRegistry(text, next));
    await stage?.("harnesses.md");
    await commit(["harnesses.md"], "update: harness registry from Agent Shell", "machine", null);
    return { registry: next };
  }

  return { allowed, commandForArea, declarations, forArea, forBrain, options, policyFor, registry, remembered, requested, saveMemory, savePolicy, saveRegistry };
}
