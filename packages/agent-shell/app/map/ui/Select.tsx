// The Map's drop-down. The Resources editor picks a resource kind through it. Options are data, not
// children, so a feature never writes a raw <option>.

import type { ChangeEvent, ReactNode } from "react";
import { Labelled } from "./Labelled.tsx";

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SelectProps = {
  /** Visible label text; the select is wrapped in a <label> with it. */
  readonly label?: string;
  /** Accessible name for a select with no visible label. */
  readonly ariaLabel?: string;
  readonly id?: string;
  readonly className?: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly onChange: (value: string) => void;
};

/** Renders one <option> for a select choice. */
function renderOption(option: SelectOption): ReactNode {
  return (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
}

/** A labelled or aria-labelled native select over a list of value and label pairs. */
export function Select(props: SelectProps): ReactNode {
  const { label, ariaLabel, options, onChange, className, ...native } = props;

  /** Reports the chosen value to the feature. */
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onChange(event.currentTarget.value);
  }

  return (
    <Labelled label={label} className={className}>
      <select {...native} aria-label={ariaLabel} onChange={handleChange}>
        {options.map(renderOption)}
      </select>
    </Labelled>
  );
}
