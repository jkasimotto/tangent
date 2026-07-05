// Runner commands ("npm run build") need their script name kept, since "npm run" alone does not
// identify what actually ran; every other command groups on its first one or two tokens.
const RUNNER_TOKENS = new Set(["npm", "yarn", "pnpm"]);

// Agent shells routinely prefix the real command with "cd <path> &&" to set the working directory
// first. Left unstripped, that prefix dominates the head ("cd &&") and every real command in the
// repo collapses into one meaningless group. Strip any number of chained "cd <path> &&" segments
// before computing the head.
const LEADING_CD_PATTERN = /^cd\s+\S+\s*&&\s*/i;

/**
 * Extracts a best-effort shell command string from a tool call's input payload. Provider adapters
 * shell out with different field names (`command`, `cmd`, `script`, an argv array), so this checks
 * the common ones rather than assuming one schema.
 */
export function extractCommandText(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const candidate = record.command ?? record.cmd ?? record.script ?? record.input;
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) {
    const parts = candidate.filter((item): item is string => typeof item === "string");
    return parts.length ? parts.join(" ") : undefined;
  }
  return undefined;
}

/**
 * Normalizes a shell command string to its "head": the first one or two meaningful tokens with
 * flags and path-like tokens stripped, so runs of the same underlying command group together
 * regardless of arguments (`dart analyze lib/foo --fatal-infos` and `dart analyze test/` both
 * normalize to "dart analyze"). Runner commands keep their script name ("npm run build"). Leading
 * "cd <path> &&" wrappers are stripped first so "cd /repo && npm test" groups with plain "npm test".
 */
export function normalizeCommandHead(commandText: string): string {
  const withoutCdPrefix = stripLeadingCdChain(commandText);
  const tokens = withoutCdPrefix.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const meaningful = tokens.filter((token) => !isFlag(token) && !looksLikePath(token));
  const head = meaningful.slice(0, 2);
  if (RUNNER_TOKENS.has(head[0] || "") && head[1] === "run" && meaningful[2]) head.push(meaningful[2]);
  return head.join(" ") || tokens[0]!;
}

/** Strips any number of chained leading "cd <path> &&" segments, returning the real command. */
function stripLeadingCdChain(commandText: string): string {
  let text = commandText.trim();
  while (LEADING_CD_PATTERN.test(text)) text = text.replace(LEADING_CD_PATTERN, "").trim();
  return text;
}

/** Returns true if the token is a CLI flag (starts with a dash). */
function isFlag(token: string): boolean {
  return token.startsWith("-");
}

/** Returns true if the token looks like a filesystem path or filename rather than a command word. */
function looksLikePath(token: string): boolean {
  return token.includes("/") || token.startsWith(".") || /\.[a-zA-Z0-9]{1,5}$/.test(token);
}
