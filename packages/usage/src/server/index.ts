import http from "node:http";

import type { UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { createUsageUiClient, type UsageUiClient } from "@tangent/usage-ui-data";
import { openUsage, type OpenUsageOptions, type UsageClient } from "../core/index.js";

export type StartUsageUiServerOptions = {
  sessionId?: string;
  repo?: string;
  scope?: "repo" | "all";
  providers?: string[];
  sources?: string[];
  host?: string;
  port?: number;
  open?: boolean;
  client?: UsageClient;
};

export type UsageUiServer = {
  url: string;
  sessionId?: string;
  close(): Promise<void>;
};

type UsageUiRequestContext = {
  client: UsageUiClient;
  usage: UsageClient;
  preferredSessionId?: string;
};

/** Starts the local Usage UI server. */
export async function startUsageUiServer(options: StartUsageUiServerOptions = {}): Promise<UsageUiServer> {
  const host = options.host || "127.0.0.1";
  const usage = options.client || await openUsage(openOptions(options));
  const client = createUsageUiClient(usage);
  const preferredSessionId = await preferredSession(options.sessionId, client);
  const [{ createLocalUiServer }, { usageUiAssets }] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/usage-ui/assets")
  ]);
  const server = await createLocalUiServer({
    product: "usage",
    host,
    port: options.port ?? 0,
    open: Boolean(options.open),
    assets: usageUiAssets,
    routes: usageApiRoutes({ client, usage, preferredSessionId })
  });
  return {
    url: server.url,
    sessionId: preferredSessionId,
    close: server.close
  };
}

/** Builds Usage API routes for the local UI server. */
function usageApiRoutes(context: UsageUiRequestContext): UiRoute[] {
  return [{
    pattern: /^\/api\/usage(?:\/.*)?$/,
    /** Handles a Usage API request. */
    handle: (request, url) => handleApiRequest(request, url, context)
  }];
}

/** Handles the local Usage API request. */
async function handleApiRequest(request: http.IncomingMessage, url: URL, context: UsageUiRequestContext): Promise<UiRouteResponse> {
  try {
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "usage") return json(404, { error: "Not found." });

    if (parts.length === 3 && parts[2] === "selection") {
      return json(200, { sessionId: context.preferredSessionId });
    }

    if (parts[2] === "sessions") {
      if (parts.length === 3) {
        return json(200, await context.client.listSessions({
          provider: stringParam(url, "provider"),
          limit: numberParam(url.searchParams.get("limit")) ?? 50
        }));
      }
      if (!parts[3]) return json(404, { error: "Missing session id." });
      const id = sessionRef(parts[3], context);
      if (parts.length === 4) return json(200, await context.client.getSession(id));
      if (parts.length === 5 && parts[4] === "cockpit") {
        return json(200, await context.client.getCockpit(id));
      }
      if (parts.length === 5 && parts[4] === "timeline") {
        return json(200, await context.client.getSessionTimeline(id, { metric: timelineMetric(url.searchParams.get("metric")) }));
      }
      if (parts.length === 5 && parts[4] === "transcript") {
        return json(200, await context.client.getTranscript(id, { includeTools: url.searchParams.get("includeTools") !== "false" }));
      }
    }

    if (parts.length === 4 && parts[2] === "messages" && parts[3] === "selection") {
      return json(200, await context.client.getMessageSelection({
        role: roleParam(url.searchParams.get("role")),
        contains: stringParam(url, "contains")
      }));
    }

    if (parts.length === 3 && parts[2] === "providers") {
      return json(200, await context.usage.providers.list());
    }

    return json(404, { error: "Not found." });
  } catch (error) {
    return json(errorStatus(error), { error: (error as Error).message });
  }
}

/** Converts server options to Usage core open options. */
function openOptions(options: StartUsageUiServerOptions): OpenUsageOptions {
  return {
    repo: options.repo || ".",
    scope: options.scope || "repo",
    providers: options.providers,
    sources: options.sources,
    contentMode: "metadata-with-excerpts",
    index: "auto"
  };
}

/** Resolves the initially selected session id. */
async function preferredSession(sessionId: string | undefined, client: UsageUiClient): Promise<string | undefined> {
  if (sessionId && sessionId !== "latest") return sessionId;
  const sessions = await client.listSessions({ limit: 1 }).catch(() => ({ sessions: [] }));
  return sessions.sessions[0]?.id;
}

/** Resolves the special selected session ref. */
function sessionRef(value: string, context: UsageUiRequestContext): string {
  return value === "selected" ? context.preferredSessionId || "latest" : value;
}

/** Reads an optional string query parameter. */
function stringParam(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) || undefined;
}

/** Reads an optional numeric query parameter. */
function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads a valid timeline metric. */
function timelineMetric(value: string | null): "durationMs" | "selfDurationMs" | "tokens.total" | "cost.amount" | undefined {
  if (value === "durationMs" || value === "selfDurationMs" || value === "tokens.total" || value === "cost.amount") return value;
  return undefined;
}

/** Reads a valid message role filter. */
function roleParam(value: string | null): "user" | "assistant" | "system" | "tool" | undefined {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return undefined;
}

/** Sends a JSON route response. */
function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Maps thrown errors to HTTP statuses. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|No usage sessions|No usage session/i.test(message) ? 404 : 500;
}
