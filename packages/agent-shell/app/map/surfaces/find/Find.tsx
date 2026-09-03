// The Find hang: the input, the position beside it, the step and cancel buttons, the window of
// matching rows, and the key line. Rendered through the Surface kit as the registered `find`
// surface, a `search` landmark named by the copy. Every key the input handles is bound through the
// kit; Escape reaches the dispatcher and pops the surface, and the Map root then runs `cancelFind`.

import type { ReactNode } from "react";
import { FIND } from "../../copy.ts";
import type { FindRow } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { Button } from "../../ui/Button.tsx";
import { KeyedSentence } from "../../ui/KeyedSentence.tsx";
import { Listbox } from "../../ui/Listbox.tsx";
import type { ListboxOption } from "../../ui/Listbox.tsx";
import { Surface } from "../../ui/Surface.tsx";
import { TextField } from "../../ui/TextField.tsx";
import type { AreaKey } from "../../units/ids.ts";
import { count, index } from "../../units/units.ts";
import type { Index } from "../../units/units.ts";
import { applyFindQuery, cancelFind, confirmFind, selectFindRow, stepFind } from "./find-effects.ts";
import type { FindEnvironment } from "./find-effects.ts";
import { activeFindIndex, findWindow } from "./find-store.ts";
import type { FindState, FindWindow } from "./find-store.ts";

/** The listbox id the input's `aria-controls` names. */
const RESULTS_ID = "tangent-map-find-results";

export type FindProps = {
  readonly state: FindState;
  /** The rows the current query matches, from `findMatches`; the root computes them once per render. */
  readonly rows: readonly FindRow[];
  readonly env: FindEnvironment;
  /** The titled ancestry of an Area, shown under each row's name. */
  readonly areaPathName: (area: AreaKey) => string;
};

/** The element id of one option, which the input points at through `aria-activedescendant`. */
function optionDomId(position: Index): string {
  return `tangent-map-find-${position}`;
}

/** One row: its kind, its name over its Area path, and a hidden mark when the Block is masked. */
function rowContent(row: FindRow, areaPathName: (area: AreaKey) => string): ReactNode {
  return (
    <>
      <small>{row.kind}</small>
      <span>
        <strong>{row.name}</strong>
        <em>{areaPathName(row.area)}</em>
      </span>
      {row.hidden && <i>{FIND.hidden}</i>}
    </>
  );
}

/** The options inside the window, each carrying its absolute position in its element id. */
function windowOptions(rows: readonly FindRow[], window: FindWindow, areaPathName: (area: AreaKey) => string): ListboxOption[] {
  const options: ListboxOption[] = [];
  for (let position = window.start; position < window.end; position = index(position + 1)) {
    const row = rows[position];
    if (row) options.push({ id: row.key, domId: optionDomId(position), content: rowContent(row, areaPathName) });
  }
  return options;
}

/** The position of a row by its key, or null when the key names no row. */
function positionOf(rows: readonly FindRow[], key: string): Index | null {
  const position = rows.findIndex((row) => row.key === key);
  return position === -1 ? null : index(position);
}

/** Renders the Find hang. */
export function Find(props: FindProps): ReactNode {
  const { state, rows, env, areaPathName } = props;
  const total = count(rows.length);
  const active = activeFindIndex(state.index, total);
  const activeRow = rows[active] ?? null;
  const typed = state.query.trim() !== "";
  const miss = typed && rows.length === 0;
  const window = findWindow(active, total, LAYOUT.findWindowTall);

  /** Previews the row a key or a click landed on. */
  function pick(key: string): void {
    const position = positionOf(rows, key);
    if (position !== null) selectFindRow(env, state, position);
  }

  /** Cancels through the store; the Map root closes the surface when `open` turns false. */
  function cancel(): void {
    cancelFind(env, state);
  }

  return (
    <Surface id="find" className="tangent-map-find" role="search" label={FIND.name} onClose={cancel} onBackStep={cancel}>
      <div className="tangent-map-find-line">
        <TextField
          ariaLabel={FIND.name}
          value={state.query}
          placeholder={FIND.placeholder}
          ariaControls={RESULTS_ID}
          {...(activeRow === null ? {} : { ariaActiveDescendant: optionDomId(active) })}
          keys={{
            /** Keeps the current match, fits its Area and closes the hang. */
            Enter: () => { confirmFind(env, state); },
            /** Moves to the next match and previews it. */
            ArrowDown: () => { stepFind(env, state, "next"); },
            /** Moves to the previous match and previews it. */
            ArrowUp: () => { stepFind(env, state, "previous"); },
          }}
          onChange={(query) => { applyFindQuery(env, query); }}
        />
        <strong className={miss ? "miss" : ""}>{!typed ? "" : miss ? FIND.noMatch : FIND.position(active, total)}</strong>
        <Button aria-label={FIND.previous} onActivate={() => { stepFind(env, state, "previous"); }}>{FIND.previousGlyph}</Button>
        <Button aria-label={FIND.next} onActivate={() => { stepFind(env, state, "next"); }}>{FIND.nextGlyph}</Button>
        <Button onActivate={cancel}>{FIND.cancel}</Button>
      </div>
      <Listbox id={RESULTS_ID} options={windowOptions(rows, window, areaPathName)} selectedId={activeRow?.key ?? null} onSelect={pick} onActivate={pick} />
      <p><KeyedSentence parts={FIND.keys} /></p>
    </Surface>
  );
}
