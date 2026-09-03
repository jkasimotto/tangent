// The one way a kit field wraps its control in a visible label.
//
// TextField, TextArea and Select share this so a labelled control always has the same shape:
// the label text first, the control inside the same <label>, which is what the browser suites and
// the old Resources editor rely on. A control with only an aria-label renders bare.

import type { ReactNode } from "react";

export type LabelledProps = {
  /** The visible label text. When absent the control renders without a wrapper. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

/** Wraps a control in a <label> when it has visible label text, otherwise renders it bare. */
export function Labelled({ label, className, children }: LabelledProps): ReactNode {
  if (label === undefined) return children;
  return (
    <label className={className}>
      {label}
      {children}
    </label>
  );
}
