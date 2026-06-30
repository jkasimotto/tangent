import { fileOidsAtRef, showFileFollowingSymlinks } from "@tangent/repo/git";

import type { EvalRunVariantState } from "../types/run.js";
import { assembleContext, contextManifest, type AssembledContext, type ContextManifest, type ContextSource } from "../core/context-assembly.js";

/** A ContextSource over a variant's frozen worktree at its context ref, the same ref showContextFile reads. */
export function variantContextSource(variant: EvalRunVariantState): ContextSource {
  const ref = variant.contextCommit || variant.baseCommit;
  return {
    /** Lists all tracked file paths at the variant's context ref. */
    listFiles: async () => [...(await fileOidsAtRef(variant.worktree, ref)).keys()],
    /** Reads one file at the variant's context ref, returning undefined when absent. */
    read: (filePath) => showFileFollowingSymlinks(variant.worktree, ref, filePath).catch(() => undefined)
  };
}

/** Lists a variant's discoverable skills and subagents (frontmatter only), for the skill picker. */
export function contextManifestView(variant: EvalRunVariantState): Promise<ContextManifest> {
  return contextManifest(variantContextSource(variant));
}

/** Assembles a variant's repo-contributed context at the cwd and loaded-skill set named in the request. */
export function assembleContextView(variant: EvalRunVariantState, url: URL): Promise<AssembledContext> {
  const cwd = url.searchParams.get("cwd") || "";
  const loadedSkills = (url.searchParams.get("skills") || "").split(",").map((name) => name.trim()).filter(Boolean);
  return assembleContext(variantContextSource(variant), cwd, loadedSkills);
}
