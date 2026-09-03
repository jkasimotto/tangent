// The surface stack: a pure reducer over the ordered list of open surface ids. The bottom is the
// oldest surface and the top is the one Escape reaches first. `MapRoot.tsx` holds it in one
// `useReducer`; `input/keyboard-dispatch.ts` asks it what Escape means before the canvas sees a key.
// Every function here returns a new stack and never touches the one it was given. When a call
// changes nothing it returns the same stack, so React sees no update.

import { SURFACES, isModalSurface } from "./surface-registry.ts";
import type { SurfaceId } from "./surface-registry.ts";

/** The open surfaces, bottom first. Contains each id at most once. */
export type SurfaceStack = readonly SurfaceId[];

/** The stack with nothing open. */
export const EMPTY_SURFACE_STACK: SurfaceStack = Object.freeze([]);

/** The closed set of things that can happen to the stack. */
export type SurfaceStackAction =
  | { readonly type: "open"; readonly id: SurfaceId }
  | { readonly type: "close"; readonly id: SurfaceId }
  | { readonly type: "back-step" }
  | { readonly type: "escape" };

/** What Escape did: the surface it removed, or `back` when there was nothing to close. */
export interface EscapeResult {
  readonly stack: SurfaceStack;
  readonly closed: SurfaceId | "back";
}

/** The surface Escape reaches first, or null when nothing is open. */
export function topSurface(stack: SurfaceStack): SurfaceId | null {
  return stack.at(-1) ?? null;
}

/** True when the surface is somewhere on the stack. */
export function isSurfaceOpen(stack: SurfaceStack, id: SurfaceId): boolean {
  return stack.includes(id);
}

/** True when a modal surface is open, which is when the canvas sits inert behind a backdrop. */
export function hasModalSurface(stack: SurfaceStack): boolean {
  return stack.some(isModalSurface);
}

/**
 * Pushes a surface. Opening a surface that is already open changes nothing. Opening a modal
 * surface first removes any other modal surface on the same layer, so the stack never holds two
 * modal surfaces on one layer; the picker and Help replace each other this way.
 */
export function openSurface(stack: SurfaceStack, id: SurfaceId): SurfaceStack {
  if (stack.includes(id)) return stack;
  const cleared = isModalSurface(id) ? stack.filter((open) => !sharesModalLayer(open, id)) : stack;
  return [...cleared, id];
}

/**
 * Removes a surface and every surface above it, because what is above was opened from it: closing
 * the Resources panel also closes the Details view it holds. Closing a surface that is not open
 * changes nothing.
 */
export function closeSurface(stack: SurfaceStack, id: SurfaceId): SurfaceStack {
  const position = stack.indexOf(id);
  return position < 0 ? stack : stack.slice(0, position);
}

/** Pops the top and leaves its parent open. An empty stack stays empty. */
export function backStep(stack: SurfaceStack): SurfaceStack {
  return stack.length === 0 ? stack : stack.slice(0, -1);
}

/**
 * What Escape does: removes the topmost surface whose declared Escape is not `none` and reports
 * which one it was. A surface declared `none`, such as the transaction toast, is passed over and
 * stays open. When nothing can be closed the stack is unchanged and the result is `back`, which
 * tells the caller Escape belongs to the canvas.
 */
export function escape(stack: SurfaceStack): EscapeResult {
  for (let position = stack.length - 1; position >= 0; position -= 1) {
    const candidate = stack[position];
    if (candidate === undefined || !acceptsEscape(candidate)) continue;
    return { stack: [...stack.slice(0, position), ...stack.slice(position + 1)], closed: candidate };
  }
  return { stack, closed: "back" };
}

/** The reducer `MapRoot.tsx` hands to `useReducer`. */
export function reduceSurfaceStack(stack: SurfaceStack, action: SurfaceStackAction): SurfaceStack {
  switch (action.type) {
    case "open":
      return openSurface(stack, action.id);
    case "close":
      return closeSurface(stack, action.id);
    case "back-step":
      return backStep(stack);
    case "escape":
      return escape(stack).stack;
  }
}

/** True when both surfaces are modal and sit on the same layer. */
function sharesModalLayer(open: SurfaceId, incoming: SurfaceId): boolean {
  return isModalSurface(open) && SURFACES[open].layer === SURFACES[incoming].layer;
}

/** True when the surface's declared Escape removes it. */
function acceptsEscape(id: SurfaceId): boolean {
  return SURFACES[id].escape !== "none";
}
