// The Map's multi-line text control. Its main use is a read-only exact target (a path or a URL) that
// selects itself on focus so it can be copied in one keystroke; the editable form takes `onChange`.

import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { runBoundKey } from "./key-bindings.ts";
import type { KeyBindings } from "./key-bindings.ts";
import { Labelled } from "./Labelled.tsx";

export type TextAreaProps = {
  /** Visible label text; the textarea is wrapped in a <label> with it. */
  readonly label?: string;
  /** Accessible name for a textarea with no visible label. */
  readonly ariaLabel?: string;
  readonly id?: string;
  readonly className?: string;
  readonly value: string;
  readonly readOnly?: boolean;
  /** Selects the whole text when the control receives focus, so a copy is one keystroke away. */
  readonly selectOnFocus?: boolean;
  /** Keys the feature handles on this control. Bound keys are consumed; the rest reach the dispatcher. */
  readonly keys?: KeyBindings;
  /** Required unless the control is read only. */
  readonly onChange?: (value: string) => void;
};

/** A labelled or aria-labelled textarea, optionally read only and self-selecting on focus. */
export function TextArea(props: TextAreaProps): ReactNode {
  const { label, ariaLabel, selectOnFocus, keys, onChange, className, ...native } = props;

  /** Reports the new text to the feature. */
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    onChange?.(event.currentTarget.value);
  }

  /** Selects the whole text when the feature asked for it. */
  function handleFocus(event: FocusEvent<HTMLTextAreaElement>): void {
    if (selectOnFocus) event.currentTarget.select();
  }

  /** Runs the feature's binding for the key, if any. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    runBoundKey(keys, event);
  }

  return (
    <Labelled label={label} className={className}>
      <textarea
        {...native}
        aria-label={ariaLabel}
        readOnly={native.readOnly ?? onChange === undefined}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
    </Labelled>
  );
}
