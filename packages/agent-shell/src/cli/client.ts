// Thin HTTP client for the `tangent area`, `tangent goal`, and `tangent idea` CLI commands. The
// Agent Shell server (packages/agent-shell/app/server.mjs) is the single writer for the vault
// (~/.tangent/trees); these commands never touch vault files directly. Mirrors
// packages/agent-shell/app/goal-command.mjs's local-server contract: default port 4321,
// loopback-only, overridable via --server or TANGENT_SHELL_URL.

import { runProcess } from "@tangent/agent-runtime/process";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4321";

/** The tmux session this command runs inside: the agent's own identity for ownership and messaging. */
export async function currentTmuxSession(): Promise<string | undefined> {
  if (!process.env.TMUX) return undefined;
  try {
    const result = await runProcess({ command: "tmux", args: ["display-message", "-p", "#S"] });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export type GoalSummary = {
  slug: string;
  file: string;
  area: string;
  title: string;
  status: string;
  doneWhen: string;
  dependsOn?: Array<{ file: string; title: string; doneWhen: string; status: string }>;
  requiredBy?: Array<{ file: string; title: string; doneWhen: string; status: string }>;
  unresolvedDependencies?: string[];
};

/** Resolves the Agent Shell server URL, rejecting anything but a loopback HTTP address. */
export function resolveServerUrl(explicit: string | undefined): URL {
  const value = explicit || process.env.TANGENT_SHELL_URL || DEFAULT_SERVER_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid --server URL: ${value}`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("--server must be a local HTTP Agent Shell URL.");
  }
  return url;
}

/** One request against the Agent Shell server, returning its status and parsed JSON body without throwing on a non-2xx response. */
async function vaultRequest(server: URL, path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  let response: Response;
  try {
    response = await fetch(new URL(path, server), init);
  } catch (error) {
    throw connectionError(server, error);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  return { status: response.status, body };
}

/** One request against the Agent Shell server, throwing with the server's own error message on a non-2xx response. */
export async function vaultFetch(server: URL, path: string, init?: RequestInit): Promise<Record<string, any>> {
  const { status, body } = await vaultRequest(server, path, init);
  if (status < 200 || status >= 300) throw new Error(body.error || `Agent Shell returned ${status}.`);
  return body;
}

/** POSTs a JSON payload to the Agent Shell server. */
export function postJson(server: URL, path: string, payload: unknown): Promise<Record<string, any>> {
  return vaultFetch(server, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

/** Every Area path in the vault, flattened from /api/tree's nested tree. */
export async function listAreaPaths(server: URL): Promise<string[]> {
  const tree = await vaultFetch(server, "/api/tree");
  const paths: string[] = [];
  /** Collects one node's path, then the paths of its children. */
  const walk = (nodes: Array<{ path: string; children: unknown[] }>) => {
    for (const node of nodes) {
      paths.push(node.path);
      walk(node.children as Array<{ path: string; children: unknown[] }>);
    }
  };
  walk(tree.areas || []);
  return paths;
}

/** Validates an Area path against the vault tree, naming the fix (the nearest existing path) when it is unknown. */
export async function requireArea(server: URL, area: string): Promise<string> {
  const paths = await listAreaPaths(server);
  if (paths.includes(area)) return area;
  const nearest = nearestMatch(area, paths);
  throw new Error(nearest
    ? `no area "${area}"; did you mean "${nearest}"?`
    : `no area "${area}"; run "tangent area list" to see existing areas.`);
}

/** Lists Goals across the vault, or one Area's own Goals when given. */
export async function listGoals(server: URL, area?: string): Promise<GoalSummary[]> {
  const query = area ? `?area=${encodeURIComponent(area)}` : "";
  const { goals } = await vaultFetch(server, `/api/goals${query}`);
  return goals as GoalSummary[];
}

/** Resolves a Goal slug to its full summary, naming the fix (the nearest slug, with its Area) when it is unknown. */
export async function requireGoal(server: URL, slug: string): Promise<GoalSummary> {
  const { status, body } = await vaultRequest(server, `/api/goals/show?slug=${encodeURIComponent(slug)}`);
  if (status === 200) return body.goal as GoalSummary;
  if (status !== 404) throw new Error(body.error || `Agent Shell returned ${status}.`);
  const goals = await listGoals(server);
  const nearestSlug = nearestMatch(slug, goals.map((goal) => goal.slug));
  const suggestion = goals.find((goal) => goal.slug === nearestSlug);
  throw new Error(suggestion
    ? `no goal "${slug}"; did you mean "${suggestion.slug}" in ${suggestion.area}?`
    : `no goal "${slug}"; run "tangent goal list" to see existing goals.`);
}

/** Returns whether a fetch failure was a refused local connection, as opposed to a real server error. */
function isConnectionRefused(error: unknown): boolean {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET";
}

/** Turns a refused connection into the actionable "start the Agent Shell" error; passes other errors through. */
function connectionError(server: URL, error: unknown): Error {
  if (isConnectionRefused(error)) {
    return new Error(`Agent Shell is not running at ${server.origin}. Start it: cd packages/agent-shell/app && npm start`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Returns the candidate closest to input by edit distance, or undefined when nothing is plausibly a typo of it. */
function nearestMatch(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshteinDistance(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(3, Math.ceil(input.length / 2)) ? best : undefined;
}

/** Classic edit-distance between two strings, for "did you mean" suggestions. */
function levenshteinDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}
