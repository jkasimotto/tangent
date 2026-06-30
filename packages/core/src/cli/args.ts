export type CliArgValue = string | boolean | string[] | undefined;

export type Args = {
  _: string[];
  [key: string]: CliArgValue;
};

export type ParseArgsOptions = {
  repeatable?: string[];
  allowInlineValues?: boolean;
};

export function parseArgs(argv: string[], options: ParseArgsOptions = {}): Args {
  const args: Args = { _: [] };
  const repeatable = new Set(options.repeatable || []);
  const allowInlineValues = options.allowInlineValues ?? true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const inlineIndex = allowInlineValues ? raw.indexOf("=") : -1;
    const key = inlineIndex >= 0 ? raw.slice(0, inlineIndex) : raw;
    const value = inlineIndex >= 0
      ? raw.slice(inlineIndex + 1)
      : argv[index + 1] && !argv[index + 1]!.startsWith("--")
        ? argv[++index]!
        : true;

    if (!repeatable.has(key)) {
      args[key] = value;
      continue;
    }

    const existing = args[key];
    if (existing === undefined) args[key] = [String(value)];
    else if (Array.isArray(existing)) existing.push(String(value));
    else args[key] = [String(existing), String(value)];
  }

  return args;
}

export function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value.at(-1) : undefined;
}

export function stringsArg(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function booleanArg(value: unknown): boolean {
  return value === true || value === "true";
}

export function numberArg(value: unknown): number | undefined {
  const valueString = stringArg(value);
  if (valueString === undefined) return undefined;
  const parsed = Number(valueString);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${valueString}.`);
  return parsed;
}

export function requiredString(value: unknown, message: string): string {
  const valueString = stringArg(value);
  if (!valueString) throw new Error(message);
  return valueString;
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
