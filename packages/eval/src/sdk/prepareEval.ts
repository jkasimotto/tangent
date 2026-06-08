import { loadEvalSpec } from "../core/config.js";
import { prepareEval as prepareLoadedEval, type PrepareEvalResult } from "../core/worktree.js";

export type { PrepareEvalResult } from "../core/worktree.js";

export async function prepareEval(specPath: string): Promise<PrepareEvalResult> {
  return prepareLoadedEval(await loadEvalSpec(specPath));
}
