// The Outline's tree: one row per Area the person can see, each with its Blocks, then its child
// Areas. Built from the world's Area nodes and the composed scene's elements, never from the DOM.
// Scope and fold decide which Areas appear: an Area outside the Only scope is absent, an Area
// under a folded root is absent, and a folded root itself stays with its children folded away.
// `Outline.tsx` renders the answer through the Tree kit and maps a row id back through
// `outlineItems`. The kernel's `tangentOf` says which elements are Blocks.

import { OUTLINE } from "../../copy.ts";
import { tangentOf } from "../../kernel/kernel-boundary.ts";
import type { AreaNode, MapEntityFacts, SceneElement, Selection } from "../../kernel/kernel-types.ts";
import type { AreaKey, RuntimeId } from "../../units/ids.ts";
import { count, index } from "../../units/units.ts";
import type { Count } from "../../units/units.ts";

/** What the Outline reads. The name functions belong to the Area labels, so both surfaces say the same words. */
export type OutlineInput = {
  readonly areas: readonly AreaNode[];
  readonly elements: readonly SceneElement[];
  readonly scopedAreas: ReadonlySet<AreaKey>;
  readonly folded: ReadonlySet<AreaKey>;
  readonly selection: Selection;
  /** The visible name of an Area: its document title, else its leaf. */
  readonly areaName: (area: AreaKey) => string;
  /** The accessible name of an Area row, equal to its name pill's. */
  readonly accessibleAreaName: (node: AreaNode) => string;
  /** Resolves one Block element to its facts, or null when it is not a Block the Outline lists. */
  readonly resolveBlock: (element: SceneElement) => MapEntityFacts | null;
};

/** One Block row under its Area. */
export type OutlineBlock = {
  readonly itemId: string;
  readonly id: RuntimeId;
  readonly level: Count;
  readonly selected: boolean;
  readonly accessibleName: string;
  readonly kindLabel: string;
  /** The visible tail after the kind: label, state words, action label. */
  readonly text: string;
  readonly facts: MapEntityFacts;
  readonly element: SceneElement;
};

/** One Area row with its Blocks and its child Areas. */
export type OutlineArea = {
  readonly itemId: string;
  readonly key: AreaKey;
  readonly node: AreaNode;
  readonly level: Count;
  readonly selected: boolean;
  /** Whether the child Areas are shown, or null for an Area with none. */
  readonly expanded: boolean | null;
  readonly accessibleName: string;
  readonly text: string;
  readonly blocks: readonly OutlineBlock[];
  readonly children: readonly OutlineArea[];
};

/** The whole Outline: its root rows, and whether no Block is on the Map at all. */
export type OutlineTree = { readonly roots: readonly OutlineArea[]; readonly empty: boolean };

/** One row of the tree as a row id resolves to it. */
export type OutlineItem = { readonly kind: "area"; readonly area: OutlineArea } | { readonly kind: "block"; readonly block: OutlineBlock };

const AREA_ITEM_PREFIX = "area:";
const BLOCK_ITEM_PREFIX = "block:";
const AREA_REGION_ROLE = "area-region";

/** True when fold has taken an Area off the canvas. A folded root is still drawn, so only its descendants hide. */
export function hiddenByFold(area: AreaKey, folded: ReadonlySet<AreaKey>): boolean {
  for (const root of folded) if (area.startsWith(`${root}/`)) return true;
  return false;
}

/**
 * The Areas inside the Only scope. Fold is not applied here: a folded Area keeps its row and says
 * `aria-expanded="false"`, and its descendants disappear because `outlineArea` stops recursing.
 */
function scopedAreaNodes(input: OutlineInput): AreaNode[] {
  return input.areas.filter((node) => input.scopedAreas.has(node.key));
}

/** Groups Areas under their parent key, each group sorted by key. */
function childrenByParent(nodes: readonly AreaNode[]): Map<string, AreaNode[]> {
  const groups = new Map<string, AreaNode[]>();
  for (const node of nodes) groups.set(node.parent, [...(groups.get(node.parent) ?? []), node]);
  for (const group of groups.values()) group.sort((left, right) => left.key.localeCompare(right.key));
  return groups;
}

/** True when a composed element is a Block the Outline lists: live, a Tangent entity, and not an Area region. */
function isOutlineBlock(element: SceneElement): boolean {
  return !element.isDeleted && tangentOf(element) !== null && element.customData?.tangent?.role !== AREA_REGION_ROLE;
}

/** Groups the resolved Blocks under their owning Area, each group sorted by label. */
function blocksByOwner(input: OutlineInput): Map<string, { element: SceneElement; facts: MapEntityFacts }[]> {
  const groups = new Map<string, { element: SceneElement; facts: MapEntityFacts }[]>();
  for (const element of input.elements) {
    const owner = element.customData?.tangentWorld?.owner;
    if (!owner || !isOutlineBlock(element)) continue;
    const facts = input.resolveBlock(element);
    if (facts) groups.set(owner, [...(groups.get(owner) ?? []), { element, facts }]);
  }
  for (const group of groups.values()) group.sort((left, right) => left.facts.display.label.localeCompare(right.facts.display.label));
  return groups;
}

/** The Areas whose region element is selected. */
function selectedAreas(input: OutlineInput): Set<AreaKey> {
  const selected = new Set<AreaKey>();
  for (const element of input.elements) {
    const area = element.customData?.tangent?.area;
    if (area && input.selection.has(element.id)) selected.add(area);
  }
  return selected;
}

/** One Block row. */
function outlineBlock(element: SceneElement, facts: MapEntityFacts, level: Count, selection: Selection): OutlineBlock {
  const { display } = facts;
  return {
    itemId: `${BLOCK_ITEM_PREFIX}${element.id}`,
    id: element.id,
    level,
    selected: selection.size === 1 && selection.has(element.id),
    accessibleName: OUTLINE.blockName(facts.accessibleName, display.actionLabel),
    kindLabel: display.kindLabel,
    text: OUTLINE.blockRow(display.label, display.stateText, display.actionLabel),
    facts,
    element,
  };
}

/** The tables the recursive build reads once. */
type OutlineTables = {
  readonly input: OutlineInput;
  readonly children: Map<string, AreaNode[]>;
  readonly blocks: Map<string, { element: SceneElement; facts: MapEntityFacts }[]>;
  readonly selected: Set<AreaKey>;
};

/** One Area row with its Blocks and, unless folded, its child rows. */
function outlineArea(node: AreaNode, tables: OutlineTables): OutlineArea {
  const { input } = tables;
  const folded = input.folded.has(node.key);
  const children = tables.children.get(node.key) ?? [];
  const level = count(node.depth + 1);
  const blockLevel = count(level + 1);
  return {
    itemId: `${AREA_ITEM_PREFIX}${node.key}`,
    key: node.key,
    node,
    level,
    selected: tables.selected.has(node.key),
    expanded: children.length ? !folded : null,
    accessibleName: input.accessibleAreaName(node),
    text: OUTLINE.areaRow(input.areaName(node.key), index(node.depth), folded ? "folded" : node.shard.state, node.shard.blockCount),
    blocks: (tables.blocks.get(node.key) ?? []).map((entry) => outlineBlock(entry.element, entry.facts, blockLevel, input.selection)),
    children: folded ? [] : children.map((child) => outlineArea(child, tables)),
  };
}

/**
 * Builds the Outline. Roots are the scoped Areas whose parent is not itself scoped, minus any Area
 * a folded ancestor has taken off the canvas, which is how an Area whose parent left the scope
 * still obeys the fold above it.
 */
export function outlineTree(input: OutlineInput): OutlineTree {
  const scoped = scopedAreaNodes(input);
  const keys = new Set<string>(scoped.map((node) => node.key));
  const tables: OutlineTables = { input, children: childrenByParent(scoped), blocks: blocksByOwner(input), selected: selectedAreas(input) };
  const roots = scoped
    .filter((node) => !keys.has(node.parent) && !hiddenByFold(node.key, input.folded))
    .sort((left, right) => left.key.localeCompare(right.key));
  return { roots: roots.map((node) => outlineArea(node, tables)), empty: ![...tables.blocks.values()].some((group) => group.length > 0) };
}

/** Every row of the tree by its row id, so the Tree kit's reports resolve to an Area or a Block. */
export function outlineItems(tree: OutlineTree): Map<string, OutlineItem> {
  const items = new Map<string, OutlineItem>();
  /** Records one Area row, its Blocks, then its children. */
  function record(area: OutlineArea): void {
    items.set(area.itemId, { kind: "area", area });
    for (const block of area.blocks) items.set(block.itemId, { kind: "block", block });
    area.children.forEach(record);
  }
  tree.roots.forEach(record);
  return items;
}
