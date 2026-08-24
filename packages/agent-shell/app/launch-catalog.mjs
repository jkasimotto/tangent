import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  inheritedLaunch, parseHarnessRegistry, resolveLaunch, upsertEnvironmentLaunch, upsertHarnessRegistry,
  validateHarnessRegistry,
} from "./launch-environment.mjs";

/** Owns launch registry reads and Area/per-run launch resolution. */
export function createLaunchCatalog({ root, readAreaNote, repository = null, commit = null, stage = null, areaFile = null, emptyAreaNote = null }) {
  /** Reads the machine-wide registry; an absent block is an empty registry. */
  async function registry() {
    const text = await readFile(path.join(root, "harnesses.md"), "utf8").catch(() => "");
    return parseHarnessRegistry(text) ?? { modelSets: {}, effortSets: {}, harnesses: [] };
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
  async function saveDefault(area, ref) {
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
    await repository.writeMarkdown(file, upsertEnvironmentLaunch(text, stored));
    await stage?.(file);
    await commit([file], `update: ${area} default launch ${resolved.label}`, area, null);
    return { label: resolved.label, command: resolved.command };
  }

  return { commandForArea, forArea, registry, requested, saveDefault, saveRegistry };
}
