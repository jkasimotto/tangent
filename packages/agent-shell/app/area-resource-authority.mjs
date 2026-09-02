import {
  areaResourceCatalogPath,
  areaResourceLabel,
  emptyAreaResourceCatalog,
  findAreaResourceRecord,
  parseAreaResourceCatalog,
} from "./area-resource-catalog.mjs";
import { isSafeResourceId } from "./public/area-map-entities.js";

/** Returns one stable catalog authority failure. */
function catalogError(status, code, message, fields = {}) {
  return Object.assign(new Error(message), { status, code, retryable: false, ...fields });
}

/** Creates the exact-byte read authority shared by placement and world preflight. */
export function createAreaResourceCatalogAuthority({ transactions }) {
  if (!transactions?.readExact) throw new TypeError("resource catalog authority requires exact transaction reads");

  /** Reads one direct catalog from the same transaction barrier as Map shards. */
  async function read(owner) {
    const file = areaResourceCatalogPath(owner);
    if (!file) throw catalogError(422, "invalid-resource-target", "The resource owner is unsafe.");
    let exact;
    try { exact = await transactions.readExact(file); }
    catch (error) {
      throw catalogError(Number(error?.status ?? 503), error?.code ?? "catalog-load-failed", `Map resources for ${owner} could not be loaded.`, { retryable: error?.retryable !== false });
    }
    if (exact.content === null) return { state: "current", owner, file, exists: false, revision: null, content: null, catalog: emptyAreaResourceCatalog() };
    const parsed = parseAreaResourceCatalog(exact.content);
    if (!parsed.ok) {
      throw catalogError(409, parsed.code, parsed.code === "catalog-unsupported" ? `Map resources for ${owner} use a newer format.` : `Map resources for ${owner} are invalid.`, { details: { errors: parsed.errors } });
    }
    return { state: "current", owner, file, exists: true, revision: parsed.revision, content: exact.content, catalog: parsed.catalog };
  }

  /** Resolves one catalog-local ID without projecting descendants or starting observations. */
  async function resolve(locator) {
    if (!locator || !isSafeResourceId(locator.id)) throw catalogError(422, "invalid-resource-target", "The resource locator is unsafe.");
    const current = await read(locator.owner);
    const record = findAreaResourceRecord(current.catalog, locator.id);
    if (!record) return { state: "missing", owner: locator.owner, locator, revision: current.revision };
    return record.membership.state === "active"
      ? { state: "active", owner: locator.owner, locator, revision: current.revision, label: areaResourceLabel(record), record }
      : { state: "tombstone", owner: locator.owner, locator, revision: current.revision, label: areaResourceLabel(record), record };
  }

  return { read, resolve };
}

export default { createAreaResourceCatalogAuthority };
