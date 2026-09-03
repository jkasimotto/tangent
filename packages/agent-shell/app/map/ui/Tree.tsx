// The Map's accessible tree: the Outline's Areas with their Blocks.
//
// Nested `ol[role="tree"]` and `ol[role="group"]` lists over data nodes, each rendered as
// `li[role="none"] > button[role="treeitem"]` with its level, selection and expansion. Like the
// Listbox it is one tab stop with a roving tabindex: ArrowDown, ArrowRight, ArrowUp, ArrowLeft,
// Home and End move focus between the items in reading order. A click reports `onSelect`; Enter and
// a double click report `onActivate` with the item's element, so a feature can run a verb and keep
// focus on the row; Space reports `onToggle`. Enter and Space are consumed here so the button's
// native click never fires a second time. `tree-roving.ts` holds the arithmetic.

import { useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { Count } from "../units/units.ts";
import { count, index } from "../units/units.ts";
import { rovingTarget } from "./listbox-roving.ts";
import { treeRovingKey, treeTabStop } from "./tree-roving.ts";

export type TreeNode = {
  /** Stable identity, reported to onSelect, onActivate and onToggle. */
  readonly id: string;
  readonly accessibleName: string;
  /** The item's depth as `aria-level` reads it: 1 at the root. */
  readonly level: Count;
  readonly selected: boolean;
  /** Whether the item's children are shown, or null for an item that has none to show. */
  readonly expanded: boolean | null;
  /** data-* attributes, keyed without the data- prefix, for the browser suites' selectors. */
  readonly data?: Readonly<Record<string, string>>;
  /** The rendered content of the item. */
  readonly content: ReactNode;
  readonly children: readonly TreeNode[];
};

export type TreeProps = {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly nodes: readonly TreeNode[];
  /** Fires on a click. */
  readonly onSelect: (id: string) => void;
  /** Fires on Enter and on a double click, with the item's element. */
  readonly onActivate: (id: string, target: HTMLElement) => void;
  /** Fires on Space. */
  readonly onToggle: (id: string) => void;
};

const ITEM_SELECTOR = '[role="treeitem"]';
const ITEM_ID_ATTRIBUTE = "data-tree-node";

/** Lists the item elements of a tree in DOM order, which is the reading order `flattenTree` uses. */
function itemElements(tree: HTMLElement): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/** The item element an event fired on, or null when it fired elsewhere. */
function itemOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(ITEM_SELECTOR) : null;
}

/** Expands a node's `data` record into data-* attributes beside the tree's own id attribute. */
function dataAttributes(node: TreeNode): Record<string, string> {
  const attributes: Record<string, string> = { [ITEM_ID_ATTRIBUTE]: node.id };
  for (const [key, value] of Object.entries(node.data ?? {})) attributes[`data-${key}`] = value;
  return attributes;
}

/** A single-select tree with a roving tabindex over nested data nodes. */
export function Tree(props: TreeProps): ReactNode {
  const { ariaLabel, className, nodes, onSelect, onActivate, onToggle } = props;
  const treeRef = useRef<HTMLOListElement>(null);
  const stop = treeTabStop(nodes);

  /** Moves focus with the roving keys, and turns Enter and Space into their reports. */
  function handleKeyDown(event: KeyboardEvent<HTMLOListElement>): void {
    const item = itemOf(event.target);
    const id = item?.getAttribute(ITEM_ID_ATTRIBUTE);
    if (!treeRef.current || !item || !id) return;
    const rovingKey = treeRovingKey(event.key);
    if (rovingKey === null && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (rovingKey !== null) {
      const items = itemElements(treeRef.current);
      items[rovingTarget(index(items.indexOf(item)), count(items.length), rovingKey)]?.focus();
    } else if (event.key === "Enter") {
      onActivate(id, item);
    } else {
      onToggle(id);
    }
  }

  /** Reports a clicked item. */
  function handleClick(event: MouseEvent<HTMLOListElement>): void {
    const id = itemOf(event.target)?.getAttribute(ITEM_ID_ATTRIBUTE);
    if (id) onSelect(id);
  }

  /** Reports a double-clicked item as an activation. */
  function handleDoubleClick(event: MouseEvent<HTMLOListElement>): void {
    const item = itemOf(event.target);
    const id = item?.getAttribute(ITEM_ID_ATTRIBUTE);
    if (item && id) {
      event.preventDefault();
      event.stopPropagation();
      onActivate(id, item);
    }
  }

  /** Renders one item and, below it, the group of its children. */
  function renderNode(node: TreeNode): ReactNode {
    return (
      <li key={node.id} role="none">
        <button
          type="button"
          role="treeitem"
          aria-label={node.accessibleName}
          aria-level={node.level}
          aria-selected={node.selected}
          aria-expanded={node.expanded ?? undefined}
          tabIndex={node.id === stop ? 0 : -1}
          {...dataAttributes(node)}
        >
          {node.content}
        </button>
        {node.children.length > 0 && <ol role="group">{node.children.map(renderNode)}</ol>}
      </li>
    );
  }

  return (
    <ol
      ref={treeRef}
      role="tree"
      aria-label={ariaLabel}
      className={className}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {nodes.map(renderNode)}
    </ol>
  );
}
