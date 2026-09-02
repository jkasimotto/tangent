/** Reports whether the composed Area-map world is the selected rollout path. */
export function areaMapWorldEnabled(value = globalThis.TANGENT_FEATURES?.areaMapWorld) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "string") return !["0", "false", "off"].includes(value.trim().toLowerCase());
  return value !== false;
}

/** Reports whether Stage 3 resource mutations and Block writers are enabled. */
export function areaMapResourceWritesEnabled(value = globalThis.TANGENT_FEATURES?.areaMapResourceWrites) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "string") return !["0", "false", "off"].includes(value.trim().toLowerCase());
  return value !== false;
}

/** Loads exactly one map authority selected by the rollout flag. */
export async function loadAreaMapAuthority(api, area, value = globalThis.TANGENT_FEATURES?.areaMapWorld) {
  if (areaMapWorldEnabled(value)) {
    const world = await api(`/api/areas/map-world?located=${encodeURIComponent(area)}`);
    if (world?.schema !== "area-map-world.v1") throw new Error(world?.error || "The server did not return an Area-map world");
    return { mode: "world", world };
  }
  const payload = await api(`/api/areas/canvas?area=${encodeURIComponent(area)}`);
  if (payload?.ok === false || !payload?.scene && !payload?.canvas) throw new Error(payload?.errors?.join("; ") || payload?.error || "The legacy Area canvas did not load");
  return { mode: "legacy", legacy: true, payload };
}

export default { areaMapResourceWritesEnabled, areaMapWorldEnabled, loadAreaMapAuthority };
