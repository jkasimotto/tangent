export type Args = {
  _: string[];
  [key: string]: string | boolean | string[];
};

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey!;
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function booleanArg(value: unknown): boolean {
  return value === true || value === "true";
}

export function providerArg(value: unknown): "claude" | "codex" | undefined {
  if (value === undefined) return undefined;
  if (value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude or codex.");
}

export function summaryProviderArg(value: unknown): "claude-cli" | "claude-sdk" | "codex-cli" | undefined {
  if (value === undefined) return undefined;
  if (value === "claude-cli" || value === "claude-sdk" || value === "codex-cli") return value;
  throw new Error("--summary-provider must be claude-cli, claude-sdk, or codex-cli.");
}

export function outputArg(value: unknown): "user-global" | "repo-local-private" | undefined {
  if (value === undefined) return undefined;
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--output must be user-global or repo-local-private.");
}

export function sandboxArg(value: unknown): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  if (value === undefined) return undefined;
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access.");
}

export function dateArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}
