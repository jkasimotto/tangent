/** The closest exact or ancestor brain whose session is live in this browser snapshot. */
export function activeBrainForArea(brains, area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let count = parts.length; count > 0; count -= 1) {
    const candidate = parts.slice(0, count).join("/");
    const brain = (brains ?? []).find((item) => item.area === candidate && item.status === "running" && item.live);
    if (brain) return brain;
  }
  return null;
}
