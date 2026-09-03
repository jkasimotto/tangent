// A Surface with a heading, a cause, and buttons. A Dialog cannot be declared without a cause and
// every button needs a label and an action, so a dialog that explains nothing or offers a button
// that does nothing cannot be written. Labels come from `copy.ts`.

import { useId } from "react";
import type { ReactNode } from "react";
import { Surface } from "./Surface.tsx";
import type { SurfaceId } from "../surfaces/surface-registry.ts";

/** One dialog button: what it says and what it does. */
export interface DialogButton {
  readonly label: string;
  readonly action: () => void;
}

export interface DialogProps {
  readonly id: SurfaceId;
  readonly className: string;
  readonly frameClassName?: string | undefined;
  readonly heading: string;
  /** The id the heading carries, when a suite or a live region needs a stable one. */
  readonly headingId?: string | undefined;
  /** Why the dialog is in front of the person: the cause they must understand before acting. */
  readonly cause: ReactNode;
  readonly buttons: readonly DialogButton[];
  readonly opener?: HTMLElement | null | undefined;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
  /** Extra content between the cause and the buttons, such as a field to copy from. */
  readonly children?: ReactNode | undefined;
}

/** Renders a dialog through the Surface kit. */
export function Dialog(props: DialogProps): ReactNode {
  const generatedId = useId();
  const headingId = props.headingId ?? generatedId;
  return (
    <Surface
      id={props.id}
      className={props.className}
      frameClassName={props.frameClassName}
      labelledBy={headingId}
      opener={props.opener}
      onClose={props.onClose}
      onBackStep={props.onBackStep}
    >
      <h2 id={headingId}>{props.heading}</h2>
      <div className="tangent-map-dialog-cause">{props.cause}</div>
      {props.children}
      <div className="tangent-map-dialog-actions">
        {props.buttons.map((button) => <DialogAction key={button.label} button={button} />)}
      </div>
    </Surface>
  );
}

/** Renders one button of the dialog. */
function DialogAction(props: { readonly button: DialogButton }): ReactNode {
  return <button type="button" onClick={props.button.action}>{props.button.label}</button>;
}
