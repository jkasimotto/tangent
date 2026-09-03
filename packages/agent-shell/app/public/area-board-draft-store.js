  /** Builds the storage key of an Area's draft. */
  const key = (area) => `tangent.area-board-draft.v1:${area}`;
  /** Creates a draft store over a Storage-like object. */
  function create(storage) {
    return {
      /** Reads an Area's saved draft, or null. */
      load(area) { try { return JSON.parse(storage.getItem(key(area)) || "null"); } catch { return null; } },
      /** Saves an Area's draft with its schema and timestamp. */
      save(area, draft) { storage.setItem(key(area), JSON.stringify({ schema: "area-board-draft.v1", area, savedAt: new Date().toISOString(), ...draft })); },
      /** Removes an Area's draft. */
      clear(area) { storage.removeItem(key(area)); },
    };
  }
export { create, key };
export default { create, key };
