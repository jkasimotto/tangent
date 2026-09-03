// The Block picker: a modal dialog docked away from the pointer, a query, the choices as one
// keyboard-reachable listbox with group headings, and the key line. Rendered through the Surface
// kit as the registered `picker` surface; the backdrop under it carries the dock side. Tab in the
// query switches between the target Area and the whole vault, Enter places the first choice and
// Shift+Enter keeps the dialog open to place another. Escape reaches the dispatcher and pops the
// surface, and the Map root then dispatches `close`.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { AREA_LABELS, PICKER } from "../../copy.ts";
import { KeyedSentence } from "../../ui/KeyedSentence.tsx";
import { Listbox, focusListboxOption } from "../../ui/Listbox.tsx";
import type { ListboxOption } from "../../ui/Listbox.tsx";
import { index } from "../../units/units.ts";
import type { KeyModifiers } from "../../ui/key-bindings.ts";
import { Surface } from "../../ui/Surface.tsx";
import { TextField } from "../../ui/TextField.tsx";
import type { AreaKey } from "../../units/ids.ts";
import { pickerEntries, pickerEntryGroup, pickerEntryId } from "./picker-choices.ts";
import type { PickerEntry } from "./picker-choices.ts";
import { pickerCorpus, placeBlock, placeFirst, searchVault } from "./picker-effects.ts";
import type { PickerEnvironment } from "./picker-effects.ts";
import type { PickerState, PickerTarget } from "./picker-store.ts";

/** The class of a group heading in the list, which the suites know. */
const GROUP_CLASS = "tangent-map-picker-group";
/** The id of the results listbox, so ArrowDown in the query can move focus into it. */
const LIST_ID = "tangent-map-picker-results";
/** The class of the backdrop, which carries the dock side. */
const BACKDROP_CLASS = "tangent-map-dialog-backdrop";

export type PickerProps = {
  readonly state: PickerState;
  readonly env: PickerEnvironment;
  /** The display name of an Area: its note title, else its leaf. */
  readonly areaName: (area: AreaKey) => string;
};

/** The last segment of an Area key, as the heading names the target. */
function areaLeaf(area: AreaKey): string {
  return area.split("/").filter(Boolean).at(-1) ?? AREA_LABELS.areaFallback;
}

/** The heading: the whole vault, outside every Area, or the target Area by its leaf. */
function heading(state: PickerState, target: PickerTarget): string {
  if (state.wide) return PICKER.wholeVault;
  return target.outside ? PICKER.outsideEveryArea : PICKER.placeIn(areaLeaf(target.area));
}

/** One choice: its kind, its title and its state words. */
function entryContent(entry: PickerEntry): ReactNode {
  return (
    <>
      <small>{entry.kind}</small>
      <span>{entry.title}</span>
      <em>{entry.status}</em>
    </>
  );
}

/** The list options, grouped under the target's Resources and the other Blocks. */
function entryOptions(entries: readonly PickerEntry[], targetName: string): ListboxOption[] {
  const hasResources = entries.some((entry) => entry.resourceRow !== undefined);
  return entries.map((entry) => {
    const group = pickerEntryGroup(entry, hasResources, targetName);
    return {
      id: pickerEntryId(entry),
      content: entryContent(entry),
      ...(entry.accessibleName === undefined ? {} : { accessibleName: entry.accessibleName }),
      ...(group === null ? {} : { group }),
    };
  });
}

/** Renders the picker while it is open; nothing otherwise. */
export function Picker(props: PickerProps): ReactNode {
  const { state, env, areaName } = props;
  const target = state.target;
  const searching = target !== null && state.wide;
  useEffect(
    /** Runs the vault search for the wide picker as the query changes. */
    () => searchVault(env, searching, state.query),
    [env, searching, state.query],
  );
  if (target === null) return null;
  const entries = pickerEntries({ query: state.query, wide: state.wide, targetArea: target.area, documents: pickerCorpus(env, state), resources: env.resourceChoices(target.area) });

  /** Closes through the store; the Map root pops the surface when `target` turns null. */
  function close(): void {
    env.dispatch({ kind: "close" });
  }

  /** Places the choice a click or Enter landed on; Shift keeps the dialog open. */
  function activate(id: string, modifiers: KeyModifiers): void {
    const entry = entries.find((candidate) => pickerEntryId(candidate) === id);
    if (entry !== undefined && target !== null) void placeBlock(env, entry, target, modifiers.shiftKey);
  }

  return (
    <Surface id="picker" className="tangent-map-picker" frameClassName={`${BACKDROP_CLASS} dock-${target.dock}`} label={PICKER.name} onClose={close} onBackStep={close}>
      <h2>{heading(state, target)}</h2>
      <TextField
        value={state.query}
        placeholder={PICKER.placeholder}
        keys={{
          /** Switches between the target Area's context and the whole vault. */
          Tab: () => { env.dispatch({ kind: "toggle-wide" }); },
          /** Places the first listed choice; Shift keeps the dialog open to place another. */
          Enter: (modifiers) => { void placeFirst(env, entries, target, modifiers.shiftKey); },
          /** Moves the keyboard from the query onto the first result; the listbox's own keys reach the rest. */
          ArrowDown: () => { focusListboxOption(LIST_ID, index(0)); },
        }}
        onChange={(query) => { env.dispatch({ kind: "set-query", query }); }}
      />
      <Listbox id={LIST_ID} options={entryOptions(entries, areaName(target.area))} selectedId={null} groupClassName={GROUP_CLASS} onActivate={activate} />
      <p><KeyedSentence parts={PICKER.keys(state.wide)} /></p>
    </Surface>
  );
}
