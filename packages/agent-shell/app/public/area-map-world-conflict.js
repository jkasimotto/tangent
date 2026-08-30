/** Clones one JSON-compatible source value. */
const clone = (value) => value === undefined ? undefined : structuredClone(value);
/** Reports exact JSON source equality for three-way comparisons. */
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Merges one identity-keyed collection with local wins for overlapping changes. */
function rebaseItems(baseItems, mineItems, currentItems, identity) {
  const base = new Map(baseItems.map((item) => [identity(item), item]));
  const mine = new Map(mineItems.map((item) => [identity(item), item]));
  const current = new Map(currentItems.map((item) => [identity(item), item]));
  const order = [...current.keys(), ...mine.keys()].filter((id, index, values) => values.indexOf(id) === index);
  const merged = [];
  for (const id of order) {
    const localChanged = !same(mine.get(id), base.get(id));
    const selected = localChanged ? mine.get(id) : current.get(id);
    if (selected !== undefined) merged.push(clone(selected));
  }
  return merged;
}

/** Rebases one local source scene over a changed external source scene. */
export function rebaseAreaMapScene(baseScene, mineScene, currentScene) {
  const base = baseScene ?? {};
  const mine = mineScene ?? {};
  const current = currentScene ?? {};
  const merged = clone(current);
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(current)])) {
    if (["elements", "files"].includes(key)) continue;
    if (!same(mine[key], base[key])) {
      if (mine[key] === undefined) delete merged[key]; else merged[key] = clone(mine[key]);
    }
  }
  merged.elements = rebaseItems(base.elements ?? [], mine.elements ?? [], current.elements ?? [], (element) => element.id);
  const baseFiles = Object.entries(base.files ?? {}).map(([id, value]) => ({ id, value }));
  const mineFiles = Object.entries(mine.files ?? {}).map(([id, value]) => ({ id, value }));
  const currentFiles = Object.entries(current.files ?? {}).map(([id, value]) => ({ id, value }));
  merged.files = Object.fromEntries(rebaseItems(baseFiles, mineFiles, currentFiles, (file) => file.id).map((file) => [file.id, file.value]));
  return merged;
}

/** Rebases every locally affected owner through exact source element IDs. */
export function rebaseAreaMapOwners({ baseByOwner, mineByOwner, currentByOwner }) {
  const result = new Map();
  for (const [owner, mine] of mineByOwner) {
    const current = currentByOwner.get(owner);
    if (!current) throw new Error(`the current world has no shard for ${owner}`);
    result.set(owner, rebaseAreaMapScene(baseByOwner.get(owner), mine, current));
  }
  return result;
}

export default { rebaseAreaMapOwners, rebaseAreaMapScene };
