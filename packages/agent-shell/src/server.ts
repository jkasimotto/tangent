import type http from "node:http";
import path from "node:path";

import type { StaticAssetMount, UiAppContext, UiRoute, UiRouteResponse } from "@tangent/ui-server";

import { createReviewedBuildEngine, type ReviewedBuildEngine } from "./engine.js";
import { readRecordedArtifact } from "./repository.js";
import type {
  ReviewedAgentBinding,
  ReviewedRunControl,
  ReviewedSessionChoice,
  StartReviewedRunInput
} from "./types.js";

export type AgentShellUiApp = {
  app: {
    id: "trees";
    label: "Work";
    routePath: "/trees";
    modulePath: string;
    stylePaths: string[];
  };
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
};

/** Creates the Agent Shell registration for the combined Tangent UI. */
export async function createAgentShellUiApp(context: UiAppContext): Promise<AgentShellUiApp> {
  const [{ agentShellUiEmbeddedAssets }] = await Promise.all([
    import("@tangent/agent-shell-ui/assets")
  ]);
  const engine = createReviewedBuildEngine({ fallbackRepository: path.resolve(context.repo || ".") });
  await engine.initialize();
  return {
    app: {
      id: "trees",
      label: "Work",
      routePath: "/trees",
      modulePath: "/apps/trees/embedded.js",
      stylePaths: ["/apps/trees/embedded.css"]
    },
    routes: reviewedBuildRoutes(engine),
    assetMounts: [{ pathPrefix: "/apps/trees", assets: agentShellUiEmbeddedAssets }]
  };
}

/** Creates the API routes for Goals, Program defaults, durable Runs, and artifacts. */
export function reviewedBuildRoutes(engine: ReviewedBuildEngine): UiRoute[] {
  return [{
    pattern: /^\/api\/work(?:\/.*)?$/,
    /** Dispatches one Agent Shell API request. */
    handle: (request, url) => handleReviewedBuildRequest(engine, request, url)
  }];
}

/** Dispatches one Agent Shell API request. */
async function handleReviewedBuildRequest(engine: ReviewedBuildEngine, request: http.IncomingMessage, url: URL): Promise<UiRouteResponse> {
  try {
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "work") return json(404, { error: "Not found." });
    if (request.method === "GET") {
      if (parts.length === 3 && parts[2] === "goals") return json(200, { goals: await engine.listGoals() });
      if (parts.length === 3 && parts[2] === "program") return json(200, await engine.program(url.searchParams.get("area") || undefined));
      if (parts.length === 3 && parts[2] === "runs") return json(200, { runs: await engine.listRuns() });
      if (parts[2] === "runs" && parts[3]) {
        const runId = parts[3];
        if (parts.length === 4) return json(200, { run: await engine.getRun(runId), latestOutput: await engine.latestOutput(runId) });
        if (parts.length === 5 && parts[4] === "diff") return text(200, await engine.diff(runId), "text/plain; charset=utf-8");
        if (parts.length === 8 && parts[4] === "artifacts") {
          const run = await engine.getRun(runId);
          const step = run.steps.find((item) => item.id === parts[5]);
          const attempt = step?.attempts.find((item) => item.number === Number(parts[6]));
          const artifact = attempt?.artifacts[Number(parts[7])];
          if (!artifact) return json(404, { error: "Artifact not found." });
          return text(200, await readRecordedArtifact(artifact), contentType(artifact.path));
        }
      }
      return json(404, { error: "Not found." });
    }

    if (process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Reviewed build changes are disabled in the verification harness." });

    if (request.method === "POST") {
      if (parts.length === 3 && parts[2] === "runs") {
        const body = await readJsonBody(request);
        const goalPath = typeof body.goalPath === "string" ? body.goalPath : "";
        if (!goalPath) return json(400, { error: "goalPath is required." });
        const input: StartReviewedRunInput = {
          goalPath,
          bindings: recordValue<ReviewedAgentBinding>(body.bindings),
          sessions: recordValue<ReviewedSessionChoice>(body.sessions)
        };
        return json(202, { run: await engine.start(input) });
      }
      if (parts.length === 5 && parts[2] === "runs" && parts[4] === "control") {
        const body = await readJsonBody(request);
        const action = body.action;
        if (action !== "stop" && action !== "resume" && action !== "retry") return json(400, { error: "Choose stop, resume, or retry." });
        const control: ReviewedRunControl = {
          action,
          ...(typeof body.decision === "string" ? { decision: body.decision } : {})
        } as ReviewedRunControl;
        return json(200, { run: await engine.control(parts[3], control) });
      }
      return json(405, { error: "Method not allowed." });
    }

    if (request.method === "PATCH" && parts.length === 6 && parts[2] === "runs" && parts[4] === "steps") {
      const body = await readJsonBody(request);
      return json(200, {
        run: await engine.updatePendingStep(parts[3], parts[5], {
          binding: objectValue<ReviewedAgentBinding>(body.binding),
          session: objectValue<ReviewedSessionChoice>(body.session)
        })
      });
    }

    if (request.method === "PUT" && parts.length === 4 && parts[2] === "defaults") {
      const body = await readJsonBody(request);
      return json(200, {
        defaults: await engine.saveAreaDefaults(parts[3], {
          bindings: recordValue<ReviewedAgentBinding>(body.bindings) || {},
          sessions: recordValue<ReviewedSessionChoice>(body.sessions) || {}
        })
      });
    }
    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Reads a bounded JSON request body. */
async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source) return {};
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

/** Narrows one unknown object value. */
function objectValue<T>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

/** Narrows one unknown record value. */
function recordValue<T>(value: unknown): Record<string, T> | undefined {
  return objectValue<Record<string, T>>(value);
}

/** Creates a JSON route response. */
function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Creates a text route response. */
function text(status: number, body: string, type: string): UiRouteResponse {
  return { status, body, headers: { "content-type": type } };
}

/** Selects a readable content type for one recorded artifact. */
function contentType(file: string): string {
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/** Maps user input errors to 400 and absent records to 404. */
function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|Unknown Reviewed build/i.test(message)) return 404;
  if (/required|invalid|cannot|only|choose|must|too large|does not support/i.test(message)) return 400;
  return 500;
}
