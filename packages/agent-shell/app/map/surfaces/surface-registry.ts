// Every Map surface, declared once. A surface is anything that opens over the canvas: the
// Resources panel and the views inside it, the recovery dialogs, the picker, Find, Outline, Help,
// the placement bar and the transaction toast. Each entry says which layer it sits on, whether it
// is modal, what Escape does to it, and where focus goes when it opens and closes. `ui/Surface.tsx`
// reads this table to render every one of them; `surface-stack.ts` reads it to keep the stack
// consistent. Nothing else declares a surface.

/** The z-index layers of `ui/layers.css`, one name per layer. */
export type SurfaceLayer = "panel" | "dialog" | "transient" | "hang" | "toast";

/**
 * How a surface owns the screen. A `modal` surface sits behind one backdrop and makes the canvas
 * inert. A `panel` stays open beside the canvas and keeps the canvas live. A `transient` surface
 * is passive and never takes focus.
 */
export type SurfaceModality = "panel" | "modal" | "transient";

/**
 * What Escape does when the surface is the top of the stack. `close` removes it and returns focus
 * to its opener. `back-step` removes it and leaves its parent open, which is how Details returns
 * to the panel instead of closing it. `none` means Escape passes through to the surface below.
 */
export type SurfaceEscape = "close" | "back-step" | "none";

/** Where focus lands when the surface opens: its heading, its first control, or nowhere. */
export type SurfaceFocusOnOpen = "heading" | "first-control" | "none";

/** One row of the registry. */
export interface SurfaceDeclaration {
  readonly layer: SurfaceLayer;
  readonly modality: SurfaceModality;
  readonly escape: SurfaceEscape;
  readonly focusOnOpen: SurfaceFocusOnOpen;
  /** True when closing returns focus to the element that opened the surface. */
  readonly restoreFocus: boolean;
}

/** The registry. This is the table in the design, section "Surfaces", and nothing more. */
export const SURFACES = {
  resources: { layer: "panel", modality: "panel", escape: "close", focusOnOpen: "heading", restoreFocus: true },
  resourceDetails: { layer: "panel", modality: "panel", escape: "back-step", focusOnOpen: "heading", restoreFocus: true },
  resourceEditor: { layer: "panel", modality: "panel", escape: "back-step", focusOnOpen: "first-control", restoreFocus: true },
  resourceRecovery: { layer: "dialog", modality: "modal", escape: "close", focusOnOpen: "first-control", restoreFocus: true },
  sceneRecovery: { layer: "dialog", modality: "modal", escape: "close", focusOnOpen: "first-control", restoreFocus: true },
  placement: { layer: "transient", modality: "transient", escape: "close", focusOnOpen: "none", restoreFocus: false },
  picker: { layer: "dialog", modality: "modal", escape: "close", focusOnOpen: "first-control", restoreFocus: true },
  find: { layer: "hang", modality: "panel", escape: "close", focusOnOpen: "first-control", restoreFocus: true },
  outline: { layer: "hang", modality: "panel", escape: "close", focusOnOpen: "first-control", restoreFocus: true },
  help: { layer: "dialog", modality: "modal", escape: "close", focusOnOpen: "heading", restoreFocus: true },
  transaction: { layer: "toast", modality: "transient", escape: "none", focusOnOpen: "none", restoreFocus: false }
} as const satisfies Record<string, SurfaceDeclaration>;

/** The name of one registered surface. */
export type SurfaceId = keyof typeof SURFACES;

/** Every registered surface id, in registry order. */
export const SURFACE_IDS: readonly SurfaceId[] = Object.freeze(Object.keys(SURFACES) as SurfaceId[]);

/** True when a string names a registered surface. */
export function isSurfaceId(value: string): value is SurfaceId {
  return Object.hasOwn(SURFACES, value);
}

/** The declaration of one surface. */
export function surfaceDeclaration(id: SurfaceId): SurfaceDeclaration {
  return SURFACES[id];
}

/** True when the surface is modal and therefore renders behind one backdrop. */
export function isModalSurface(id: SurfaceId): boolean {
  return SURFACES[id].modality === "modal";
}
