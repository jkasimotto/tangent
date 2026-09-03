// The roving-tabindex arithmetic of the Tree, kept pure so it is tested under Node.
//
// A tree is one tab stop, like a listbox: the first selected item (else the first item) carries
// tabIndex 0 and the arrow keys move focus between the items in reading order. The Tree flattens
// its nested nodes into that reading order here, so the tab stop and every move are answered over
// one flat list and `listbox-roving.ts` supplies the clamped arithmetic. ArrowRight and ArrowLeft
// walk the same list as ArrowDown and ArrowUp, which is what the old Outline did and what a
// nested tree with no separate expand key needs.

import type { RovingKey } from "./listbox-roving.ts";
import { isRovingKey } from "./listbox-roving.ts";

/** The part of a tree node the roving arithmetic reads: its identity, its selection, its children. */
export type RovingTreeNode = {
  readonly id: string;
  readonly selected: boolean;
  readonly children: readonly RovingTreeNode[];
};

/** The keys that move focus inside a tree: the listbox keys plus the horizontal arrows. */
export type TreeKey = RovingKey | "ArrowRight" | "ArrowLeft";

/** The listbox key each tree key moves like, or null for a key that does not move focus. */
export function treeRovingKey(key: string): RovingKey | null {
  if (key === "ArrowRight") return "ArrowDown";
  if (key === "ArrowLeft") return "ArrowUp";
  return isRovingKey(key) ? key : null;
}

/** The ids of every node in reading order: each node before its children, depth first. */
export function flattenTree(nodes: readonly RovingTreeNode[]): RovingTreeNode[] {
  const flat: RovingTreeNode[] = [];
  for (const node of nodes) {
    flat.push(node);
    flat.push(...flattenTree(node.children));
  }
  return flat;
}

/** The id of the node that carries tabIndex 0: the first selected node, else the first node, or null when the tree is empty. */
export function treeTabStop(nodes: readonly RovingTreeNode[]): string | null {
  const flat = flattenTree(nodes);
  return (flat.find((node) => node.selected) ?? flat[0])?.id ?? null;
}
