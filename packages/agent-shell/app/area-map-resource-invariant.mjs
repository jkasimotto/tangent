import { tangentOf } from "./public/area-board-core.js";

/** Returns every persisted resource Block, including retained hidden roots. */
function resourceBlocks(scene) {
  return (scene?.elements ?? []).filter((element) => tangentOf(element)?.kind === "resource");
}

/** Returns one stable failure without leaking a catalog target. */
function failure(status, code, error, fields = {}) {
  return { status, code, error, retryable: false, ...fields };
}

/**
 * Validates one source-scene transition against catalog membership.
 * Existing unresolved or tombstoned references may survive ordinary edits,
 * but a new or changed reference needs one active same-owner association.
 */
export async function validateAreaResourceSceneTransition({ owner, currentScene, nextScene, resolveResource }) {
  const next = resourceBlocks(nextScene);
  if (!next.length) return null;
  if (owner === "@root") return failure(422, "invalid-resource-target", "A resource Block cannot be owned by @root.");
  const byResource = new Map();
  for (const block of next) {
    const id = tangentOf(block).ref;
    const rows = byResource.get(id) ?? [];
    rows.push(block.id);
    byResource.set(id, rows);
  }
  for (const [id, sourceIds] of byResource) if (sourceIds.length > 1) {
    return failure(409, "resource-representation-conflict", "One Area resource can have only one visible or hidden Map Block.", {
      resource: { owner, id },
      sourceElementIds: sourceIds,
    });
  }
  const currentBySource = new Map(resourceBlocks(currentScene).map((block) => [block.id, tangentOf(block).ref]));
  const changed = next.filter((block) => currentBySource.get(block.id) !== tangentOf(block).ref);
  if (!changed.length) return null;
  // Mixed-version callers that have no catalog capability retain inert
  // resource metadata. Current Agent Shell composition always supplies the
  // resolver and therefore enforces membership before it writes.
  if (typeof resolveResource !== "function") return null;
  for (const block of changed) {
    const id = tangentOf(block).ref;
    let resolved;
    try { resolved = await resolveResource({ owner, id }); }
    catch (error) {
      return failure(Number(error?.status ?? 503), error?.code ?? "catalog-load-failed", "Map resource membership is unavailable.", { retryable: error?.retryable !== false });
    }
    if (resolved?.state !== "active") {
      return failure(resolved?.state === "missing" ? 404 : 409, "resource-not-found", "A new Map resource Block requires an active association in the same Area.", { resource: { owner, id } });
    }
  }
  return null;
}

export default { validateAreaResourceSceneTransition };
