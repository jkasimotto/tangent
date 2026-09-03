// The Outline hang: the Area tree with its Blocks, at the top right of the Map. It is the `outline`
// surface of the registry, a non-modal panel on the hang layer that leaves the canvas live, closed
// by Escape or its Close button. `outline-model.ts` decides which rows exist and what each says;
// this file turns them into the Tree kit's nodes and maps the kit's reports back to an Area or a
// Block. Focus opens on the first tree item rather than the Close button, which is the fix for the
// audit defect where the Outline opened with nothing focused.

import type { MouseEvent, ReactNode } from "react";
import { OUTLINE } from "../../copy.ts";
import type { AreaKey } from "../../units/ids.ts";
import { Button } from "../../ui/Button.tsx";
import { Surface } from "../../ui/Surface.tsx";
import { Tree } from "../../ui/Tree.tsx";
import type { TreeNode } from "../../ui/Tree.tsx";
import { outlineItems } from "./outline-model.ts";
import type { OutlineArea, OutlineBlock, OutlineTree } from "./outline-model.ts";

export type OutlineProps = {
  readonly tree: OutlineTree;
  /** The control that opened the Outline, so focus returns to it on close. */
  readonly opener?: HTMLElement | null | undefined;
  /** A click on an Area row: select it without moving the camera. */
  readonly onSelectArea: (area: AreaKey) => void;
  /** Enter or a double click on an Area row: select it and fit the camera to it. */
  readonly onFitArea: (area: AreaKey) => void;
  /** Space on an Area row. */
  readonly onToggleFold: (area: AreaKey) => void;
  /** A click or Space on a Block row: select it and bring it into view. */
  readonly onSelectBlock: (block: OutlineBlock) => void;
  /** Enter or a double click on a Block row: run its primary action, with the row as the opener. */
  readonly onRunBlock: (block: OutlineBlock, row: HTMLElement) => void;
  /** The empty Outline's way to put a first Block on the Map. */
  readonly onPlaceBlock: () => void;
  /** The empty Outline's way to the Resources panel, with the pressed button as the opener. */
  readonly onOpenResources: (opener: HTMLElement) => void;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
};

const CLASS_NAME = "tangent-map-outline visible";
const CLOSE_CLASS_NAME = "tangent-map-outline-close";
const EMPTY_CLASS_NAME = "tangent-map-outline-empty";
const AREA_DATA_KEY = "outline-area";
const BLOCK_DATA_KEY = "outline-block";

/** The selector the Surface opens focus on: the first row of the tree, behind the Close button. */
const FIRST_ROW_SELECTOR = '[role="treeitem"]';

/** One Block row as a leaf node of the tree. */
function blockNode(block: OutlineBlock): TreeNode {
  return {
    id: block.itemId,
    accessibleName: block.accessibleName,
    level: block.level,
    selected: block.selected,
    expanded: null,
    data: { [BLOCK_DATA_KEY]: block.id },
    content: <><small>{block.kindLabel}</small>{block.text}</>,
    children: [],
  };
}

/** One Area row with its Blocks first and its child Areas after, which is the reading order. */
function areaNode(area: OutlineArea): TreeNode {
  return {
    id: area.itemId,
    accessibleName: area.accessibleName,
    level: area.level,
    selected: area.selected,
    expanded: area.expanded,
    data: { [AREA_DATA_KEY]: area.key },
    content: area.text,
    children: [...area.blocks.map(blockNode), ...area.children.map(areaNode)],
  };
}

/** Renders the Outline. */
export function Outline(props: OutlineProps): ReactNode {
  const { tree, onSelectArea, onFitArea, onToggleFold, onSelectBlock, onRunBlock } = props;
  const items = outlineItems(tree);

  /** A click reports the row: an Area is selected where it is, a Block is selected and shown. */
  function handleSelect(id: string): void {
    const item = items.get(id);
    if (item?.kind === "area") onSelectArea(item.area.key);
    else if (item?.kind === "block") onSelectBlock(item.block);
  }

  /** Enter and a double click fit an Area and run a Block's primary action. */
  function handleActivate(id: string, row: HTMLElement): void {
    const item = items.get(id);
    if (item?.kind === "area") onFitArea(item.area.key);
    else if (item?.kind === "block") onRunBlock(item.block, row);
  }

  /** Space folds an Area and selects a Block, the way it does on the canvas. */
  function handleToggle(id: string): void {
    const item = items.get(id);
    if (item?.kind === "area") onToggleFold(item.area.key);
    else if (item?.kind === "block") onSelectBlock(item.block);
  }

  /** Opens the Resources panel and remembers the pressed button as its opener. */
  function handleOpenResources(event: MouseEvent<HTMLButtonElement>): void {
    props.onOpenResources(event.currentTarget);
  }

  return (
    <Surface
      id="outline"
      className={CLASS_NAME}
      label={OUTLINE.name}
      initialFocus={FIRST_ROW_SELECTOR}
      opener={props.opener}
      onClose={props.onClose}
      onBackStep={props.onBackStep}
    >
      <header>
        <strong>{OUTLINE.title}</strong>
        <Button className={CLOSE_CLASS_NAME} label={OUTLINE.close} onActivate={props.onClose} />
      </header>
      <Tree
        ariaLabel={OUTLINE.title}
        nodes={tree.roots.map(areaNode)}
        onSelect={handleSelect}
        onActivate={handleActivate}
        onToggle={handleToggle}
      />
      {tree.empty && (
        <div className={EMPTY_CLASS_NAME}>
          <p>{OUTLINE.empty}</p>
          <Button label={OUTLINE.block} onActivate={props.onPlaceBlock} />
          <Button label={OUTLINE.resources} onActivate={handleOpenResources} />
        </div>
      )}
    </Surface>
  );
}
