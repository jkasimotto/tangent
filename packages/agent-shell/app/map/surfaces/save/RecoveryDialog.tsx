// The offer to restore or discard the draft the controller kept after a failed save. It is the
// `sceneRecovery` surface of the registry: modal, on the dialog layer, closed by Escape, focus on
// its first button. The heading names the draft's time and the cause names the failure in words,
// so neither Restore nor Discard is a dead end (audit defect 10). The choices themselves are the
// controller's `restoreDraft` and `discardDraft`, wired by `MapRoot.tsx` through the props.

import type { ReactNode } from "react";
import type { DraftRecord } from "../../kernel/kernel-types.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import type { DialogButton } from "../../ui/Dialog.tsx";
import { draftOffer } from "./recovery-model.ts";

export type RecoveryDialogProps = {
  readonly draft: DraftRecord;
  readonly opener?: HTMLElement | null | undefined;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
};

const CLASS_NAME = "tangent-map-draft-choice";

/** Renders the draft offer through the Dialog kit. */
export function RecoveryDialog(props: RecoveryDialogProps): ReactNode {
  const offer = draftOffer(props.draft);
  const buttons: readonly DialogButton[] = [
    { label: offer.restore, action: props.onRestore },
    { label: offer.discard, action: props.onDiscard },
  ];
  return (
    <Dialog
      id="mapRecovery"
      className={CLASS_NAME}
      heading={offer.heading}
      cause={<p role="alert">{offer.cause.headline} {offer.cause.nextStep}</p>}
      buttons={buttons}
      opener={props.opener}
      onClose={props.onClose}
      onBackStep={props.onBackStep}
    />
  );
}
