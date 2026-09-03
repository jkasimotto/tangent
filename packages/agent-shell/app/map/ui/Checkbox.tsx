// The Map's checkbox. The label follows the box, the way a confirmation reads ("Add this path as
// Missing"), so it does not share Labelled with the text controls.

import type { ChangeEvent, ReactNode } from "react";

export type CheckboxProps = {
  /** The visible label text after the box. */
  readonly label: string;
  readonly className?: string;
  readonly id?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
};

/** A native checkbox followed by its label text, both inside one <label>. */
export function Checkbox({ label, className, id, checked, disabled, onChange }: CheckboxProps): ReactNode {
  /** Reports the new checked state to the feature. */
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.currentTarget.checked);
  }

  return (
    <label className={className}>
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={handleChange} /> {label}
    </label>
  );
}
