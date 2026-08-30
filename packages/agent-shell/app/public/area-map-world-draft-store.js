const DATABASE = "tangent-area-map-world";
const STORE = "drafts";
const VERSION = 1;

/** Converts one IndexedDB request into a rejecting Promise. */
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  });
}

/** Opens the private recovery database when this browser permits it. */
async function openDatabase(indexedDB) {
  if (!indexedDB?.open) return null;
  const request = indexedDB.open(DATABASE, VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "worldId" });
  }, { once: true });
  return requestValue(request);
}

/** Creates private IndexedDB recovery keyed by stable world ID. */
export function createAreaMapWorldDraftStore({ indexedDB = globalThis.indexedDB } = {}) {
  let database = null;
  const ready = openDatabase(indexedDB).then((value) => { database = value; return value; }).catch(() => null);
  /** Runs one store operation without making recovery storage authoritative. */
  async function run(mode, operation) {
    const db = database ?? await ready; if (!db) return null;
    const transaction = db.transaction(STORE, mode); const result = operation(transaction.objectStore(STORE));
    return result ? requestValue(result).catch(() => null) : null;
  }
  return {
    /** Loads the recovery record for one world. */
    load: (worldId) => run("readonly", (store) => store.get(worldId)),
    /** Saves one complete recovery record. */
    save: (record) => run("readwrite", (store) => store.put(structuredClone(record))),
    /** Removes one explicitly discarded recovery record. */
    remove: (worldId) => run("readwrite", (store) => store.delete(worldId)),
    /** Closes the private recovery database connection. */
    close() { database?.close?.(); database = null; },
  };
}

export default { createAreaMapWorldDraftStore };
