export const MAP_BRAIN_DEFAULT_WIDTH = 560;
export const MAP_BRAIN_MIN_WIDTH = 420;
export const MAP_MIN_WIDTH = 560;
export const MAP_DOCK_MIN_VIEWPORT = 1120;

/** Chooses only among truthful existing brain presentations. */
export function mapBrainMode(brain, session) {
  if (session) return { kind: "terminal", session: session.name };
  if (brain?.live) return { kind: "resuming" };
  return { kind: "start", resume: Boolean(brain) };
}

/** Keeps the remembered divider inside the product's usable bounds. */
export function mapBrainWidth(value, available) {
  const requested = Number(value) || MAP_BRAIN_DEFAULT_WIDTH;
  return Math.round(Math.max(MAP_BRAIN_MIN_WIDTH, Math.min(available / 2, requested)));
}

/** A dock is honest only when both columns retain their minimum width. */
export function mapBrainCanDock(viewport, available, width) {
  return viewport >= MAP_DOCK_MIN_VIEWPORT && available - width >= MAP_MIN_WIDTH;
}

export default { mapBrainMode, mapBrainWidth, mapBrainCanDock };
