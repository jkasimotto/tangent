// The Map's control row: Block, Resources, the selected Block's verbs, Outline and Keys.
//
// Every button is a kit `Button` inside the kit `Toolbar`, so the wide and the narrow layouts swap
// glyph for label through map.css, and the words all come from `copy.ts`. The verbs group appears
// only while exactly one semantic Block is the whole selection, which is the rule the world suite
// asserts by name.

import type { MouseEvent, ReactNode } from "react";
import { TOOLBAR } from "../copy.ts";
import type { MapEntityAction, MapEntityFacts } from "../kernel/kernel-types.ts";
import { Button } from "../ui/Button.tsx";
import { Toolbar } from "../ui/Toolbar.tsx";

export type MapToolbarProps = {
  /** The facts of the one selected Block, or null when the selection is anything else. */
  readonly block: MapEntityFacts | null;
  readonly resourcesOpen: boolean;
  readonly outlineOpen: boolean;
  /** True while the catalog and transport allow a resource write. */
  readonly writesAvailable: boolean;
  readonly onPlaceBlock: () => void;
  readonly onOpenResources: (opener: HTMLElement) => void;
  readonly onToggleOutline: () => void;
  readonly onOpenHelp: (opener: HTMLElement) => void;
  readonly onRunAction: (facts: MapEntityFacts, action: MapEntityAction, opener: HTMLElement) => void;
  readonly onAddToArea: (facts: MapEntityFacts, opener: HTMLElement) => void;
  readonly onShowDetails: (facts: MapEntityFacts, opener: HTMLElement) => void;
  readonly onHideBlock: () => void;
};

/** The accessible name of the selected Block: its resource name when it has one, else its label. */
function blockName(block: MapEntityFacts): string {
  const name = block.reference.kind === "resource" ? block.accessibleName : block.display.label;
  return name === null || name === undefined || name === "" ? TOOLBAR.blockFallback : name;
}

/** The verbs beside one selected Block: its primary action, Add to Area, Details and Hide. */
function BlockVerbs(props: MapToolbarProps & { readonly block: MapEntityFacts }): ReactNode {
  const { block } = props;
  const name = blockName(block);
  const linkOutsideArea = block.reference.kind === "link" && block.source !== null && block.source !== undefined && block.source.owner !== "@root";
  return (
    <div className="tangent-map-verbs" role="group" aria-label={TOOLBAR.verbsGroupName(name)}>
      {block.primaryAction && (
        <Button
          aria-label={TOOLBAR.verbName(block.display.actionLabel ?? "", name)}
          kbd={TOOLBAR.primaryKey}
          onActivate={(event: MouseEvent<HTMLButtonElement>) => props.onRunAction(block, block.primaryAction as MapEntityAction, event.currentTarget)}
        >
          {block.display.actionLabel}
        </Button>
      )}
      {linkOutsideArea && (
        <Button
          disabled={!props.writesAvailable}
          aria-label={TOOLBAR.verbName(TOOLBAR.addToArea, block.accessibleName)}
          onActivate={(event: MouseEvent<HTMLButtonElement>) => props.onAddToArea(block, event.currentTarget)}
        >
          {TOOLBAR.addToArea}
        </Button>
      )}
      {block.reference.kind === "resource" && (
        <Button aria-label={TOOLBAR.verbName(TOOLBAR.details, name)} onActivate={(event: MouseEvent<HTMLButtonElement>) => props.onShowDetails(block, event.currentTarget)}>
          {TOOLBAR.details}
        </Button>
      )}
      <Button aria-label={TOOLBAR.verbName(TOOLBAR.hide, name)} kbd={TOOLBAR.hideKey} onActivate={props.onHideBlock}>
        {TOOLBAR.hide}
      </Button>
    </div>
  );
}

/** Renders the Map's top-right control row. */
export function MapToolbar(props: MapToolbarProps): ReactNode {
  return (
    <Toolbar>
      <div className="tangent-map-toolbar-extra">
        <Button
          title={TOOLBAR.placeBlockTitle}
          aria-keyshortcuts={TOOLBAR.placeBlockShortcuts}
          glyph={TOOLBAR.placeBlockGlyph}
          label={TOOLBAR.placeBlockLabel}
          kbd={TOOLBAR.placeBlockKey}
          onActivate={props.onPlaceBlock}
        />
      </div>
      <Button
        className="tangent-map-resources-button"
        title={TOOLBAR.resourcesTitle}
        aria-expanded={props.resourcesOpen}
        glyph={TOOLBAR.resourcesGlyph}
        label={TOOLBAR.resourcesLabel}
        onActivate={(event: MouseEvent<HTMLButtonElement>) => props.onOpenResources(event.currentTarget)}
      />
      {props.block !== null && <BlockVerbs {...props} block={props.block} />}
      <Button title={TOOLBAR.outlineTitle} aria-expanded={props.outlineOpen} glyph={TOOLBAR.outlineGlyph} label={TOOLBAR.outlineLabel} onActivate={props.onToggleOutline} />
      <Button
        title={TOOLBAR.keysTitle}
        aria-keyshortcuts={TOOLBAR.keysShortcuts}
        glyph={TOOLBAR.keysGlyph}
        label={TOOLBAR.keysLabel}
        kbd={TOOLBAR.keysKey}
        onActivate={(event: MouseEvent<HTMLButtonElement>) => props.onOpenHelp(event.currentTarget)}
      />
    </Toolbar>
  );
}
