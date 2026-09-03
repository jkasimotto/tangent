// The Map's single-line text input. Find, the picker query, the Resources filter and the editor
// fields all render through here. A feature binds keys through `keys` (see key-bindings.ts) instead
// of writing onKeyDown, and Escape always bubbles to the host dispatcher.

import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { runBoundKey } from "./key-bindings.ts";
import type { KeyBindings } from "./key-bindings.ts";
import { Labelled } from "./Labelled.tsx";

export type TextFieldProps = {
  /** Visible label text; the input is wrapped in a <label> with it. */
  readonly label?: string;
  /** Accessible name for an input with no visible label, such as Find. */
  readonly ariaLabel?: string;
  readonly id?: string;
  readonly className?: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  /** The listbox this input drives, for a combobox-like pairing such as Find. */
  readonly ariaControls?: string;
  /** The option this input currently points at, when it drives a listbox. */
  readonly ariaActiveDescendant?: string;
  /** Keys the feature handles on this field. Bound keys are consumed; the rest reach the dispatcher. */
  readonly keys?: KeyBindings;
  readonly onChange: (value: string) => void;
};

/** A labelled or aria-labelled single-line input with feature-bound keys. */
export function TextField(props: TextFieldProps): ReactNode {
  const { label, ariaLabel, ariaControls, ariaActiveDescendant, keys, onChange, className, ...native } = props;

  /** Reports the new text to the feature. */
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.currentTarget.value);
  }

  /** Runs the feature's binding for the key, if any. */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    runBoundKey(keys, event);
  }

  return (
    <Labelled label={label} className={className}>
      <input
        {...native}
        type="text"
        aria-label={ariaLabel}
        aria-controls={ariaControls}
        aria-activedescendant={ariaActiveDescendant}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </Labelled>
  );
}
