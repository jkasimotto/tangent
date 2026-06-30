import { requiredString, stringArg, type Args } from "../args.js";
import { findVariant, loadRunManifest } from "../../core/run-store.js";
import { resolveRunId } from "./shared.js";

/** Handles the `eval open` subcommand, printing the worktree path for a variant. */
export async function openCommand(args: Args): Promise<void> {
  const runId = await resolveRunId(requiredString(args._[1], "eval open requires <run-id>."));
  const variantId = requiredString(args._[2], "eval open requires <variant>.");
  const manifest = await loadRunManifest(runId);
  const variant = findVariant(manifest, variantId, stringArg(args.case));
  console.log(variant.worktree);
}
