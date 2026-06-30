import { booleanArg, dateArg, parseArgs, parseDate, stringsArg, stringArg, type Args } from "@tangent/core/cli";

export { booleanArg, dateArg, parseArgs, parseDate, stringsArg, stringArg, type Args };

/** Parses and validates the --provider argument, returning its typed value. */
export function providerArg(value: unknown): "claude" | "codex" | undefined {
  if (value === undefined) return undefined;
  if (value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude or codex.");
}

/** Parses and validates the --summary-provider argument, returning its typed value. */
export function summaryProviderArg(value: unknown): "claude-cli" | "claude-sdk" | "codex-cli" | undefined {
  if (value === undefined) return undefined;
  if (value === "claude-cli" || value === "claude-sdk" || value === "codex-cli") return value;
  throw new Error("--summary-provider must be claude-cli, claude-sdk, or codex-cli.");
}

/** Parses and validates the --output argument, returning its typed value. */
export function outputArg(value: unknown): "user-global" | "repo-local-private" | undefined {
  if (value === undefined) return undefined;
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--output must be user-global or repo-local-private.");
}

/** Parses and validates the --sandbox argument, returning its typed value. */
export function sandboxArg(value: unknown): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  if (value === undefined) return undefined;
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access.");
}
