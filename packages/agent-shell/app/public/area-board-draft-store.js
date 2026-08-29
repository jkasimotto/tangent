  const key = (area) => `tangent.area-board-draft.v1:${area}`;
  function create(storage) {
    return {
      load(area) { try { return JSON.parse(storage.getItem(key(area)) || "null"); } catch { return null; } },
      save(area, draft) { storage.setItem(key(area), JSON.stringify({ schema: "area-board-draft.v1", area, savedAt: new Date().toISOString(), ...draft })); },
      clear(area) { storage.removeItem(key(area)); },
    };
  }
export { create, key };
export default { create, key };
