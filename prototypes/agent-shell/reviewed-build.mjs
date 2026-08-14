/**
 * Reviewed build bridge for the standalone Agent Shell.
 *
 * The bridge keeps HTTP details in the native app and keeps the durable state
 * machine in @tangent/agent-shell. A test can inject an engine without loading
 * compiled workspace packages.
 */

/** Creates a lazy Reviewed build API bridge. */
export function createReviewedBuildBridge(options = {}) {
  let enginePromise;

  /** Loads and initializes the durable engine on first use. */
  const getEngine = async () => {
    if (!enginePromise) {
      enginePromise = options.engine
        ? Promise.resolve(options.engine)
        : import("@tangent/agent-shell").catch((error) => {
            throw new Error(`Reviewed build runtime is not built. Run npm run build -w @tangent/agent-shell. ${error instanceof Error ? error.message : String(error)}`);
          }).then(async ({ createReviewedBuildEngine }) => {
            const engine = createReviewedBuildEngine({
              treesRoot: options.treesRoot,
              loopsRoot: options.loopsRoot,
              fallbackRepository: options.fallbackRepository,
            });
            await engine.initialize();
            return engine;
          });
    }
    return enginePromise;
  };

  return {
    /** Handles one Reviewed build request and reports whether the route matched. */
    async handle(request, response, url) {
      if (!url.pathname.startsWith("/api/reviewed-build")) return false;
      try {
        await dispatch(await getEngine(), request, response, url);
      } catch (error) {
        sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    },
  };
}

/** Dispatches one Reviewed build API request. */
async function dispatch(engine, request, response, url) {
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] !== "api" || parts[1] !== "reviewed-build") return sendJson(response, 404, { error: "Not found." });

  if (request.method === "GET") {
    if (parts.length === 3 && parts[2] === "goals") return sendJson(response, 200, { goals: await engine.listGoals() });
    if (parts.length === 3 && parts[2] === "program") return sendJson(response, 200, await engine.program(url.searchParams.get("area") || undefined));
    if (parts.length === 3 && parts[2] === "runs") return sendJson(response, 200, { runs: await engine.listRuns() });
    if (parts[2] === "runs" && parts[3]) {
      const runId = parts[3];
      if (parts.length === 4) return sendJson(response, 200, { run: await engine.getRun(runId), latestOutput: await engine.latestOutput(runId) });
      if (parts.length === 5 && parts[4] === "diff") return sendText(response, 200, await engine.diff(runId), "text/plain; charset=utf-8");
      if (parts.length === 8 && parts[4] === "artifacts") {
        const artifact = await engine.artifact(runId, parts[5], Number(parts[6]), Number(parts[7]));
        return sendText(response, 200, artifact.content, contentType(artifact.path));
      }
    }
    return sendJson(response, 404, { error: "Not found." });
  }

  if (process.env.TANGENT_VERIFY_READONLY) {
    return sendJson(response, 403, { error: "Reviewed build changes are disabled in the verification harness." });
  }

  if (request.method === "POST") {
    if (parts.length === 3 && parts[2] === "runs") {
      const body = await readJsonBody(request);
      if (typeof body.goalPath !== "string" || !body.goalPath) return sendJson(response, 400, { error: "goalPath is required." });
      return sendJson(response, 202, {
        run: await engine.start({
          goalPath: body.goalPath,
          bindings: recordValue(body.bindings),
          sessions: recordValue(body.sessions),
        }),
      });
    }
    if (parts.length === 5 && parts[2] === "runs" && parts[4] === "control") {
      const body = await readJsonBody(request);
      if (!["stop", "resume", "retry"].includes(body.action)) return sendJson(response, 400, { error: "Choose stop, resume, or retry." });
      return sendJson(response, 200, {
        run: await engine.control(parts[3], {
          action: body.action,
          ...(typeof body.decision === "string" ? { decision: body.decision } : {}),
        }),
      });
    }
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  if (request.method === "PATCH" && parts.length === 6 && parts[2] === "runs" && parts[4] === "steps") {
    const body = await readJsonBody(request);
    return sendJson(response, 200, {
      run: await engine.updatePendingStep(parts[3], parts[5], {
        binding: objectValue(body.binding),
        session: objectValue(body.session),
      }),
    });
  }

  if (request.method === "PUT" && parts.length === 4 && parts[2] === "defaults") {
    const body = await readJsonBody(request);
    return sendJson(response, 200, {
      defaults: await engine.saveAreaDefaults(parts[3], {
        bindings: recordValue(body.bindings) || {},
        sessions: recordValue(body.sessions) || {},
      }),
    });
  }

  return sendJson(response, 405, { error: "Method not allowed." });
}

/** Reads a bounded JSON request body. */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source) return {};
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value;
}

/** Narrows one unknown object value. */
function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** Narrows one unknown record value. */
function recordValue(value) {
  return objectValue(value);
}

/** Sends one JSON response. */
function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

/** Sends one text response. */
function sendText(response, status, body, type) {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

/** Selects a readable content type for one recorded artifact. */
function contentType(file) {
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/** Maps input errors to 400 and absent records to 404. */
function errorStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|Unknown Reviewed build/i.test(message)) return 404;
  if (/required|invalid|cannot|only|choose|must|too large|does not support/i.test(message)) return 400;
  return 500;
}
