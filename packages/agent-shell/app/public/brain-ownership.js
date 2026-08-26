/** The exact Area brain whose session is active in this browser snapshot. */
export function activeBrainForArea(brains, area) {
  return (brains ?? []).find((item) => item.area === String(area ?? "") && item.status === "active" && item.live) ?? null;
}
