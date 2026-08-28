import { readJson, sendJson } from "./http-json.mjs";

/** Creates routes for work definition, harness configuration, and launching. */
export function createLaunchRoutes(operations) {
  const routes = new Map([
    ["POST /api/work/describe", describe],
    ["GET /api/harnesses", readHarnesses],
    ["POST /api/harnesses", writeHarnesses],
    ["GET /api/launch/options", options],
    ["POST /api/launch/default", saveDefault],
    ["POST /api/launch/policy", savePolicy],
    ["POST /api/goals/start", start],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Opens a work-definition session. */
  async function describe(request, response) { sendResult(response, await operations.describe(await readJson(request))); }
  /** Returns the harness registry. */
  async function readHarnesses(_request, response) { sendResult(response, await operations.readHarnesses()); }
  /** Validates and saves the harness registry. */
  async function writeHarnesses(request, response) { sendResult(response, await operations.writeHarnesses(await readJson(request))); }
  /** Returns launch options for one Area. */
  async function options(_request, response, url) { sendResult(response, await operations.options(url.searchParams.get("area") ?? "", url.searchParams.get("kind") ?? "launch")); }
  /** Reports that Area defaults are retired. */
  async function saveDefault(_request, response) { sendResult(response, { status: 410, error: "launch defaults are retired", code: "defaults-retired" }); }
  /** Saves an Area's allowed launch policy. */
  async function savePolicy(request, response) { sendResult(response, await operations.savePolicy(await readJson(request))); }
  /** Starts one Goal agent or pipeline. */
  async function start(request, response) { sendResult(response, await operations.start(await readJson(request))); }

  /** Sends one `{status, value|error}` operation result. */
  function sendResult(response, result) { sendJson(response, result.status, result.value ?? { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.launch ? { launch: result.launch } : {}), ...(result.area ? { area: result.area } : {}), ...(result.allowed ? { allowed: result.allowed } : {}) }); }
  return { handle };
}
