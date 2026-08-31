import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for shell lifecycle and tmux controls. */
export function createShellControlRoutes(operations) {
  const routes = new Map([
    ["POST /api/spawn", spawn],
    ["POST /api/caffeinate", caffeinate],
    ["POST /api/shell/rebuild", rebuild],
    ["POST /api/shell/migrate-launch-policy", migrateLaunchPolicy],
    ["POST /api/goals/stop", stopGoal],
    ["POST /api/agent", agent],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname.startsWith("/api/kill/")) {
      await kill(request, response, url);
      return true;
    }
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response);
    return true;
  }

  /** Spawns one plain tmux work session. */
  async function spawn(request, response) {
    const body = await readJson(request);
    try {
      const result = await operations.spawn(body.area, body.name);
      sendJson(response, result.status, result.status === 200 ? { ok: true } : { error: result.error });
    } catch (error) {
      sendJson(response, 500, { error: String(error.stderr ?? error.message ?? error) });
    }
  }

  /** Toggles the process-owned sleep assertion. */
  async function caffeinate(request, response) {
    const result = operations.caffeinate(Boolean((await readJson(request)).on));
    sendJson(response, 200, { ok: true, caffeinate: result });
  }

  /** Starts an explicit rebuild, or rejects it in verification mode. */
  async function rebuild(_request, response) {
    const result = await operations.rebuild();
    sendJson(response, result.status, result.value);
  }

  /** Previews or applies the one-time Area launch-policy migration. */
  async function migrateLaunchPolicy(request, response) {
    const result = await operations.migrateLaunchPolicy(await readJson(request));
    sendJson(response, result.status, result.value ?? { error: result.error, ...(result.code ? { code: result.code } : {}) });
  }

  /** Changes the orchestrator command. */
  async function agent(request, response) {
    const command = String((await readJson(request)).cmd ?? "").trim();
    if (!command) { sendJson(response, 400, { error: "cmd required" }); return; }
    sendJson(response, 200, { ok: true, agent: await operations.agent(command) });
  }

  /** Stops the exact live session that the selected Goal displayed. */
  async function stopGoal(request, response) {
    const result = await operations.stopGoal(await readJson(request));
    sendJson(response, result.status, result.status === 200 ? result.value : { error: result.error, ...(result.code ? { code: result.code } : {}) });
  }

  /** Kills one exact tmux session. */
  async function kill(_request, response, url) {
    const name = decodeURIComponent(url.pathname.slice("/api/kill/".length));
    const result = await operations.kill(name, url.searchParams.get("target") ?? "");
    sendJson(response, result.status, result.status === 200 ? result.value : { error: result.error });
  }

  return { handle };
}
