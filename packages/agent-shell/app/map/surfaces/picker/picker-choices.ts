// The choices the picker lists, built through the kernel's picker model: the target Area's
// Resources first, then its Goals, Documents, Areas and links, or the whole vault when the picker is
// wide. A typed reference (a path, a URL, a vault ref) is offered first when nothing listed already
// names it. Pure over its inputs so it is tested under Node against the real kernel.

import { PICKER } from "../../copy.ts";
import type { Representation } from "../../copy.ts";
import { entityChoices, referenceFromText, wideChoices } from "../../kernel/kernel-boundary.ts";
import type { BlockChoice, MapEntityFacts, ResourcePanelRow, VaultDocument, VaultIndexItem } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import type { AreaKey, ShardOwner } from "../../units/ids.ts";

/** One choice the picker offers. A Resource choice carries its panel row so placing it goes through the placement bar. */
export type PickerEntry = BlockChoice & {
  /** The shard the Block belongs to when it is not the target Area's: a Resource's owning Area. */
  readonly owner?: ShardOwner;
  readonly accessibleName?: string;
  readonly resourceRow?: ResourcePanelRow;
};

/** What the Resources surface knows about one current row: the row, its resolved facts, its Map state. */
export type ResourceChoiceFacts = {
  readonly row: ResourcePanelRow;
  readonly facts: MapEntityFacts;
  readonly representation: Representation;
};

/** Everything `pickerEntries` reads. */
export type PickerEntriesInput = {
  readonly query: string;
  readonly wide: boolean;
  readonly targetArea: AreaKey;
  readonly documents: readonly VaultDocument[];
  readonly resources: readonly ResourceChoiceFacts[];
};

/** The vault search results merged over the known documents, one record per file, the search winning. */
export function pickerDocuments(entities: readonly VaultDocument[], known: readonly VaultDocument[]): VaultDocument[] {
  const byFile = new Map<string, VaultDocument>();
  for (const item of [...entities, ...known]) if (item.file && !byFile.has(item.file)) byFile.set(item.file, item);
  return [...byFile.values()];
}

/** The documents as the vault-wide search reads them: every record that names its kind. */
export function vaultIndexItems(documents: readonly VaultDocument[]): VaultIndexItem[] {
  return documents.filter((item): item is VaultDocument & { kind: string } => typeof item.kind === "string");
}

/** One Resource row as a picker choice: its label, its state words with its Map state, and its full accessible name. */
export function resourceEntry(facts: ResourceChoiceFacts): PickerEntry {
  const { locator } = facts.row.entity;
  return {
    kind: "resource",
    ref: locator.id,
    owner: locator.owner,
    title: facts.facts.display.label,
    status: [...facts.facts.display.stateText, PICKER.placementStatus(facts.representation)].join(PICKER.statusSeparator),
    accessibleName: PICKER.resourceChoiceName(facts.facts.accessibleName, facts.representation),
    resourceRow: facts.row,
  };
}

/** The choices matching the typed text inside one source: every choice when nothing is typed. */
function matching(source: readonly PickerEntry[], query: string): readonly PickerEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return source;
  return source.filter((entry) => `${entry.kind} ${entry.title} ${entry.ref}`.toLowerCase().includes(needle));
}

/** The choices the picker lists, at most a window of them, a typed reference first. */
export function pickerEntries(input: PickerEntriesInput): PickerEntry[] {
  const index = vaultIndexItems(input.documents);
  const contextual: PickerEntry[] = [...input.resources.map(resourceEntry), ...entityChoices(input.targetArea, input.documents)];
  const listed = input.wide ? wideChoices(input.query, index) : matching(contextual, input.query);
  const typed = referenceFromText(input.query, [...contextual, ...wideChoices("", index)]);
  const entries = typed !== null && !listed.some((entry) => entry.ref === typed.ref) ? [typed, ...listed] : listed;
  return entries.slice(0, LAYOUT.pickerWindow);
}

/** The stable identity of one entry in the list. */
export function pickerEntryId(entry: PickerEntry): string {
  return `${entry.kind}:${entry.owner ?? ""}:${entry.ref}`;
}

/** The heading over an entry: the Resources of the target, then the other Blocks, or nothing when there are no Resources. */
export function pickerEntryGroup(entry: PickerEntry, hasResources: boolean, targetName: string): string | null {
  if (entry.resourceRow !== undefined) return PICKER.resourcesIn(targetName);
  return hasResources ? PICKER.otherBlocks : null;
}
