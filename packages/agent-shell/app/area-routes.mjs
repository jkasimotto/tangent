import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for Area discovery and mutation. */
export function createAreaRoutes(operations) {
  const routes = new Map([
    ["GET /api/tree", tree],
    ["GET /api/areas/show", show],
    ["POST /api/areas/new", create],
    ["POST /api/areas/preview-move", previewMove],
    ["POST /api/areas/move", move],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Returns the complete Area tree. */
  async function tree(_request, response) {
    sendJson(response, 200, await operations.tree());
  }

  /** Returns one Area's note, Goals, and ideas. */
  async function show(_request, response, url) {
    const area = url.searchParams.get("area") ?? "";
    const result = await operations.show(area);
    sendJson(response, result ? 200 : 404, result ?? { error: `no area "${area}"` });
  }

  /** Creates one nested Area. */
  async function create(request, response) {
    await mutate(request, response, operations.create);
  }

  /** Validates and describes an Area move without changing it. */
  async function previewMove(request, response) {
    await mutate(request, response, operations.previewMove);
  }

  /** Moves an Area and its descendants. */
  async function move(request, response) {
    await mutate(request, response, operations.move);
  }

  /** Runs one conflict-producing Area mutation. */
  async function mutate(request, response, operation) {
    try {
      sendJson(response, 200, await operation(await readJson(request)));
    } catch (error) {
      sendJson(response, 409, { error: String(error.stderr ?? error.message ?? error) });
    }
  }

  return { handle };
}
