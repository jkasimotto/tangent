import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyLaunchAliases, areaHarnessContractText, areaLaunchPolicy, harnessEfforts, harnessModels, launchAllowedByPolicy, launchMatches, launchRef, modelEfforts, parseAreaHarnessContract, parseEnvironmentBlock, parseHarnessRegistry, parseLaunch, resolveLaunch, upsertHarnessRegistry,
  validateHarnessRegistry,
} from "./launch-environment.mjs";

/** Owns launch registry reads and Area/per-run launch resolution. */
export function createLaunchCatalog({ root, readAreaNote, repository = null, commit = null, stage = null, areaFile = null, emptyAreaNote = null, memory = null, listAreas = null }) {
  /** Reads one explicit Area contract; absence is distinct from an empty contract. */
  async function readAreaHarness(area) {
    return readFile(path.join(root, area, "harnesses.md"), "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  }
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
    return current.error ? current : areaLaunchPolicy(area, readAreaNote, current, readAreaHarness);
  }

  /** Resolves a registered launch and checks it against one Area. */
  async function allowed(area, ref) {
    const policy = await policyFor(area);
    if (policy.error) return policy;
    const canonical = applyLaunchAliases(ref, policy.aliases);
    if (canonical.error) return canonical;
    const resolved = resolveLaunch(await registry(), canonical);
    if (resolved.error) return resolved;
    if (launchAllowedByPolicy(policy, resolved)) return { ...resolved, policy };
    // A policy is inherited, so the Area that refuses a launch is often an
    // ancestor of the Area it was started in. Name the Area whose contract
    // rejected it, or the reader edits the wrong harnesses.md.
    const refusal = (policy.restrictions ?? []).find((entry) => !entry.allow.some((pattern) => launchMatches(pattern, resolved)));
    const allow = (refusal?.allow ?? policy.allow ?? []).map(launchRef);
    return {
      error: `launch ${launchRef(ref)} is not allowed by the ${refusal?.area ?? area} policy: ${allow.join(", ") || "none"}`,
      code: "launch-not-allowed",
      launch: launchRef(ref),
      area,
      declaredBy: refusal?.area ?? area,
      allowed: allow,
    };
  }

  /** Finds the nearest registered and allowed remembered launch. */
  async function remembered(area, kind = "work") {
    const policy = await policyFor(area);
    if (policy.error) return policy;
    const current = await registry();
    const saved = await memory?.read?.() ?? {};
    const ancestors = String(area).split("/").map((_, index, parts) => parts.slice(0, parts.length - index).join("/"));
    for (const source of ancestors) {
      const ref = saved[source]?.[kind];
      const resolved = ref ? resolveLaunch(current, ref) : null;
      if (resolved && !resolved.error && launchAllowedByPolicy(policy, resolved)) return { ...ref, source };
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
    const current = await registry();
    const contract = parseAreaHarnessContract(await readAreaHarness(area), current);
    if (contract?.error) return { error: `${area}/harnesses.md: ${contract.error}` };
    const environment = contract ?? parseEnvironmentBlock(await readAreaNote(area));
    if (environment?.error) return { error: `${area}: ${environment.error}` };
    return { allow: environment?.allow ?? [], aliases: environment?.aliases ?? {}, contract: contract ? (contract.stale ? "stale" : "valid") : environment ? "legacy" : "missing" };
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
    const accepted = (ref) => !area || launchAllowedByPolicy(policy, ref);
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
      policy: { allow: policy.allow ?? [], declaredBy: policy.declaredBy ?? [], unrestricted: policy.unrestricted, health: policy.health, contracts: policy.contracts },
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
    if (!repository || !commit) throw new Error("launch catalog is read-only");
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
    const file = `${area}/harnesses.md`;
    const existing = parseAreaHarnessContract(await readAreaHarness(area), current);
    if (existing?.error) return { error: `${area}/harnesses.md: ${existing.error}`, code: "harness-contract-invalid" };
    const legacy = parseEnvironmentBlock(await readAreaNote(area));
    const aliases = existing?.aliases ?? legacy?.aliases ?? {};
    const next = areaHarnessContractText({ allow: patterns, aliases, registry: current });
    /** Reads the proposed contract at the target and durable contracts elsewhere. */
    const nextHarnessReader = (candidate) => candidate === area ? next : readAreaHarness(candidate);
    for (const descendant of await listAreas?.() ?? [area]) {
      if (descendant !== area && !descendant.startsWith(`${area}/`)) continue;
      const proposed = await areaLaunchPolicy(descendant, readAreaNote, current, nextHarnessReader);
      if (proposed.error) return proposed;
      if (!proposed.launches.length) return { error: `policy would leave ${descendant} with no allowed launch`, code: "policy-empties-child", area: descendant };
    }
    await repository.writeMarkdown(file, next);
    await stage?.(file);
    await commit([file], `update: ${area} allowed launches ${patterns.map(launchRef).join(", ") || "inherit"}`, area, null);
    return { policy: await areaLaunchPolicy(area, readAreaNote, current, nextHarnessReader) };
  }

  /** Creates or refreshes one Area contract without changing its effective policy. */
  async function repairContract(area, { force = false, commitChange = true } = {}) {
    if (!repository) throw new Error("launch catalog is read-only");
    const current = await registry();
    if (current.error) return current;
    const text = await readAreaHarness(area);
    const contract = parseAreaHarnessContract(text, current);
    if (contract?.error && !force) return { error: `${area}/harnesses.md: ${contract.error}`, code: "harness-contract-invalid" };
    if (contract && !contract.stale) return { changed: false, state: "valid", file: `${area}/harnesses.md` };
    const legacy = parseEnvironmentBlock(await readAreaNote(area));
    if (legacy?.error) return { error: `${area}: ${legacy.error}` };
    const allow = contract?.allow ?? legacy?.allow ?? [];
    const aliases = contract?.aliases ?? legacy?.aliases ?? {};
    const file = `${area}/harnesses.md`;
    await repository.writeMarkdown(file, areaHarnessContractText({ allow, aliases, registry: current }));
    await stage?.(file);
    if (commitChange && commit) await commit([file], `update: ${area} harness contract`, area, null);
    return { changed: true, state: contract ? "stale" : legacy ? "legacy" : "missing", file, allow: allow.map(launchRef), aliases };
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

  return { allowed, commandForArea, declarations, forArea, forBrain, options, policyFor, registry, remembered, repairContract, requested, saveMemory, savePolicy, saveRegistry };
}
