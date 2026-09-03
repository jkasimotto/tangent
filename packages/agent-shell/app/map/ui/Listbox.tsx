// The Map's list of choices: Find's results, the picker's Blocks, the Outline's rows.
//
// It is one tab stop with a roving tabindex: the selected option (else the first) carries tabIndex
// 0, and ArrowUp, ArrowDown, Home and End move focus between the options, so every option is
// reachable from the keyboard, not only the first (audit defect 7). Selection follows focus: a
// roving move reports the option through `onSelect`. Click, Enter and Space report the option
// through `onActivate` with the modifiers, so Shift+Enter can mean "place another". Options are data
// so a feature never writes a raw role="option" element. `listbox-roving.ts` holds the arithmetic.

import { useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { count, index } from "../units/units.ts";
import type { Index } from "../units/units.ts";
import { modifiersOf } from "./key-bindings.ts";
import type { KeyModifiers } from "./key-bindings.ts";
import { isRovingKey, rovingTarget, tabStop } from "./listbox-roving.ts";

export type ListboxOption = {
  /** Stable identity, reported to onSelect and onActivate. */
  readonly id: string;
  /** Element id, for an input's aria-activedescendant. */
  readonly domId?: string;
  /** Accessible name when the content is not readable as a name. */
  readonly accessibleName?: string;
  /** A heading rendered once before the first option of a run that shares it. */
  readonly group?: string;
  /** The rendered content of the option. */
  readonly content: ReactNode;
};

export type ListboxProps = {
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  /** The class of a group heading; the picker's suites know it as `tangent-map-picker-group`. */
  readonly groupClassName?: string;
  readonly options: readonly ListboxOption[];
  /** The selected option, or null for none. It is the tab stop and carries aria-selected. */
  readonly selectedId: string | null;
  /** Fires when focus moves to an option with the keyboard. */
  readonly onSelect?: (id: string) => void;
  /** Fires on click, Enter and Space. */
  readonly onActivate: (id: string, modifiers: KeyModifiers) => void;
};

const OPTION_SELECTOR = '[role="option"]';
const DEFAULT_GROUP_CLASS = "tangent-map-listbox-group";

/** Lists the option elements of a listbox in DOM order, which is the order of `options`. */
function optionElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
}

/** The position of the option element the event fired on, or null when it fired elsewhere. */
function optionIndexOf(list: HTMLElement, target: EventTarget | null): Index | null {
  if (!(target instanceof Element)) return null;
  const option = target.closest<HTMLElement>(OPTION_SELECTOR);
  if (!option) return null;
  const position = optionElements(list).indexOf(option);
  return position === -1 ? null : index(position);
}

/** The position of the selected option in `options`, or null when nothing selected is listed. */
function selectedIndexOf(options: readonly ListboxOption[], selectedId: string | null): Index | null {
  if (selectedId === null) return null;
  const position = options.findIndex((option) => option.id === selectedId);
  return position === -1 ? null : index(position);
}

/** A single-select listbox with a roving tabindex over data-driven options. */
export function Listbox(props: ListboxProps): ReactNode {
  const { id, ariaLabel, className, groupClassName, options, selectedId, onSelect, onActivate } = props;
  const listRef = useRef<HTMLUListElement>(null);
  const total = count(options.length);
  const stop = tabStop(selectedIndexOf(options, selectedId), total);

  /** Moves focus with the roving keys and lets selection follow it. */
  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const list = listRef.current;
    if (!list || !isRovingKey(event.key)) return;
    const current = optionIndexOf(list, event.target);
    if (current === null) return;
    event.preventDefault();
    event.stopPropagation();
    const target = rovingTarget(current, total, event.key);
    optionElements(list)[target]?.focus();
    const option = options[target];
    if (option) onSelect?.(option.id);
  }

  /** Reports a clicked option; Enter and Space on a focused option arrive here as clicks too. */
  function handleClick(event: MouseEvent<HTMLUListElement>): void {
    const list = listRef.current;
    if (!list) return;
    const position = optionIndexOf(list, event.target);
    const option = position === null ? undefined : options[position];
    if (option) onActivate(option.id, modifiersOf(event));
  }

  /** Renders one option with its group heading when it starts a new run. */
  function renderOption(option: ListboxOption, position: Index): ReactNode {
    const previous = options[position - 1];
    const startsGroup = option.group !== undefined && option.group !== previous?.group;
    return (
      <li key={option.id}>
        {startsGroup && <div className={groupClassName ?? DEFAULT_GROUP_CLASS}>{option.group}</div>}
        <button
          type="button"
          role="option"
          id={option.domId}
          aria-label={option.accessibleName}
          aria-selected={option.id === selectedId}
          tabIndex={position === stop ? 0 : -1}
        >
          {option.content}
        </button>
      </li>
    );
  }

  /** Renders every option in order. A loop, not map, so the position carries the Index brand. */
  function renderOptions(): ReactNode[] {
    const rows: ReactNode[] = [];
    for (let position = index(0); position < total; position = index(position + 1)) {
      const option = options[position];
      if (option) rows.push(renderOption(option, position));
    }
    return rows;
  }

  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      className={className}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      {renderOptions()}
    </ul>
  );
}
