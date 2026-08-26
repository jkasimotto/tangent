import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for local processes and commands. */
export function createProgramRoutes(operations) {
  const routes = new Map([
    ["GET /api/operations", list],
    ["POST /api/operations/new", create],
    ["POST /api/operations/control", control],
    ...(process.env.TANGENT_LEGACY_PROGRAM_API === "1" ? [
      ["GET /api/programs", list],
      ["POST /api/programs/new", create],
      ["POST /api/programs/control", control],
    ] : []),
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response);
    return true;
  }

  /** Returns every configured program and its live status. */
  async function list(_request, response) {
    sendJson(response, 200, await operations.list());
  }

  /** Creates one process or command. */
  async function create(request, response) {
    await mutate(request, response, operations.create);
  }

  /** Applies one supported control action to a program. */
  async function control(request, response) {
    await mutate(request, response, operations.control);
  }

  /** Runs one conflict-producing program mutation. */
  async function mutate(request, response, operation) {
    try {
      sendJson(response, 200, await operation(await readJson(request)));
    } catch (error) {
      sendJson(response, 409, { error: String(error.stderr ?? error.message ?? error) });
    }
  }

  return { handle };
}
