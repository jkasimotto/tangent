import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  harnessEfforts, harnessModels, inheritedBrainLaunch, inheritedLaunch, modelEfforts, parseHarnessRegistry, resolveLaunch, upsertEnvironmentLaunch, upsertHarnessRegistry,
  validateHarnessRegistry,
} from "./launch-environment.mjs";

/** Owns launch registry reads and Area/per-run launch resolution. */
export function createLaunchCatalog({ root, readAreaNote, repository = null, commit = null, stage = null, areaFile = null, emptyAreaNote = null }) {
  /** Reads the machine-wide registry; an absent block is an empty registry. */
  async function registry() {
    const text = await readFile(path.join(root, "harnesses.md"), "utf8").catch(() => "");
    const parsed = parseHarnessRegistry(text) ?? { modelSets: {}, effortSets: {}, harnesses: [] };
    if (parsed.error) return parsed;
    const error = validateHarnessRegistry(parsed);
    return error ? { error: `harness registry is invalid: ${error}` } : parsed;
  }

  /** Resolves the inherited launch declaration for one Area. */
  async function forArea(area) {
    const current = await registry();
    if (current.error) return { error: current.error };
    return inheritedLaunch(area, readAreaNote, current);
  }

  /** Returns the exact command for one Area or throws its declaration error. */
  async function commandForArea(area) {
    const launch = await forArea(area);
    if (launch.error) throw new Error(launch.error);
    return launch.command;
  }

  /** Resolves the inherited brain launch, then the declared Area work default. */
  async function forBrain(area) {
    const current = await registry();
    if (current.error) return { error: current.error };
    const declared = await inheritedBrainLaunch(area, readAreaNote, current);
    if (declared) return declared;
    const work = await inheritedLaunch(area, readAreaNote, current, { fallback: false });
    return work ?? { error: `${area}: no brain or work launch is declared` };
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
        })),
      })),
      efforts: harnessEfforts(current, harness).map((effort) => ({
        id: effort.id,
        label: effort.label || effort.id,
        args: effort.args,
        command: launchFor(harness, null, effort).command,
      })),
    }));
    const workDefault = area ? await inheritedLaunch(area, readAreaNote, current) : null;
    let brainDefault = null;
    if (area) {
      brainDefault = await forBrain(area);
    }
    return {
      source: path.join(root, "harnesses.md"),
      ...(area ? { area } : {}),
      harnesses,
      ...(kind === "all" ? { workDefault, brainDefault } : { default: kind === "brain" ? brainDefault : workDefault }),
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

  /** Validates and writes the complete machine registry through the vault owner. */
  async function saveRegistry(input) {
    if (!repository || !commit) throw new Error("launch catalog is read-only");
    const next = {
      version: 1,
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

  /** Resolves and persists one Area's explicit default launch. */
  async function saveDefault(area, ref, kind = "launch") {
    if (!repository || !commit || !areaFile || !emptyAreaNote) throw new Error("launch catalog is read-only");
    const current = await registry();
    const resolved = current.error ? current : resolveLaunch(current, ref ?? {});
    if (resolved.error || !area) return { error: resolved.error || "an area is required" };
    const file = areaFile(area);
    const text = await readFile(path.join(root, file), "utf8").catch(() => emptyAreaNote(area));
    const stored = {
      harness: resolved.harness,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(resolved.effort ? { effort: resolved.effort } : {}),
    };
    await repository.writeMarkdown(file, upsertEnvironmentLaunch(text, stored, kind));
    await stage?.(file);
    await commit([file], `update: ${area} default ${kind === "brain" ? "brain " : ""}launch ${resolved.label}`, area, null);
    return { label: resolved.label, command: resolved.command };
  }

  return { commandForArea, forArea, forBrain, options, registry, requested, saveDefault, saveRegistry };
}
