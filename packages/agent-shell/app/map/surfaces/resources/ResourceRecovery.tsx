// The two modal recovery dialogs of the Resources panel, both rendered through the Dialog kit so
// each one states its cause and gives every button an action. The first is what a browser refused:
// a copy or an open, with the exact text selectable so the person can finish it by hand. The
// second is a scene-coupled transaction: the Add-back confirmation, or the retry after it failed.

import type { ReactNode } from "react";
import { RESOURCE_RECOVERY, SCENE_RECOVERY, copyForFailure } from "../../copy.ts";
import type { RecoverableActionKind } from "../../copy.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import type { DialogButton } from "../../ui/Dialog.tsx";
import { TextArea } from "../../ui/TextArea.tsx";
import { closeResourceRecovery, closeSceneRecovery, copyBlockedLink, retryResourceAction } from "./resource-actions.ts";
import { confirmAddBack, retrySceneResourceMutation } from "./resources-scene-mutations.ts";
import type { ResourceActionRecovery, ResourceSceneRecovery, ResourcesState } from "./resources-state.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type ResourceRecoveryProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The frame both dialogs render in; the suites wait for it to be gone. */
const FRAME_CLASS = "tangent-map-resource-recovery";

/** The heading ids the two dialogs are labelled by. */
const ACTION_TITLE_ID = "tangent-map-resource-recovery-title";
const SCENE_TITLE_ID = "tangent-map-resource-scene-recovery-title";

/** The exact text of a refused copy or open: what the browser handed back, else what the action named. */
function recoveryText(recovery: ResourceActionRecovery): string {
  if (recovery.result.kind === "clipboard-blocked") return recovery.result.copy.value;
  if (recovery.result.kind === "popup-blocked") return recovery.result.url;
  const action = recovery.action;
  if (action.kind === "copy-path") return action.path;
  return action.kind === "copy-url" || action.kind === "open-url" ? action.url : "";
}

/** The kind of the refused action, which decides the dialog's words and its buttons. */
function recoveryKind(recovery: ResourceActionRecovery): RecoverableActionKind {
  const kind = recovery.action.kind;
  if (kind === "copy-url" || kind === "open-url") return kind;
  return "copy-path";
}

/** Renders the dialog a refused copy or open leaves, or nothing when nothing was refused. */
export function ResourceActionRecoveryDialog(props: ResourceRecoveryProps): ReactNode {
  const { state, ports } = props;
  const recovery = state.recovery;
  if (!recovery) return null;
  const effects = ports.effects;
  const kind = recoveryKind(recovery);
  const label = recovery.entity.display.label;
  const targetLabel = recovery.action.kind === "open-url" ? recovery.action.targetLabel : "";

  /** Closes the dialog. The kit returns focus to the control that ran the action. */
  function close(): void {
    closeResourceRecovery(effects);
  }

  const retry: DialogButton = {
    label: kind === "open-url" ? RESOURCE_RECOVERY.tryAgain : RESOURCE_RECOVERY.retry,
    /** Runs the same action again; the dialog closes only once it went through. */
    action: () => { void retryResourceAction(effects); },
  };
  const copyLink: DialogButton = {
    label: RESOURCE_RECOVERY.copyLink,
    /** Copies the URL the browser would not open, through the same recovery surface. */
    action: () => { void copyBlockedLink(effects); },
  };
  const buttons = kind === "open-url" ? [retry, copyLink] : [retry];
  return (
    <Dialog
      id="resourceRecovery"
      className="tangent-map-resource-recovery-dialog"
      frameClassName={FRAME_CLASS}
      heading={RESOURCE_RECOVERY.title(kind, label, targetLabel)}
      headingId={ACTION_TITLE_ID}
      cause={<p role="alert">{recovery.message}</p>}
      buttons={[...buttons, { label: RESOURCE_RECOVERY.close, action: close }]}
      onClose={close}
      onBackStep={close}
    >
      <TextArea ariaLabel={RESOURCE_RECOVERY.textName(kind, label)} value={recoveryText(recovery)} readOnly selectOnFocus />
    </Dialog>
  );
}

/** The heading of the scene dialog: the Add-back question, or the transaction that did not save. */
function sceneHeading(recovery: ResourceSceneRecovery): string {
  return recovery.phase === "confirm-add-back" ? SCENE_RECOVERY.addBackTitle(recovery.label) : SCENE_RECOVERY.notSaved;
}

/** The cause of the scene dialog: what Add-back does, or why the transaction did not save. */
function SceneCause(props: { readonly recovery: ResourceSceneRecovery }): ReactNode {
  const recovery = props.recovery;
  if (recovery.phase === "confirm-add-back") return <p>{SCENE_RECOVERY.addBackExplanation}</p>;
  const nextStep = recovery.phase === "error" ? copyForFailure(recovery.code).nextStep : "";
  return <p role="alert">{recovery.message} {nextStep}</p>;
}

/** Renders the Add-back confirmation or the failed scene transaction, or nothing when neither is open. */
export function SceneRecoveryDialog(props: ResourceRecoveryProps): ReactNode {
  const { state, ports } = props;
  const recovery = state.sceneRecovery;
  if (!recovery) return null;
  const effects = ports.effects;

  /** Closes the dialog and keeps the retained envelope for a later retry. */
  function close(): void {
    closeSceneRecovery(effects);
  }

  const confirming = recovery.phase === "confirm-add-back";
  /** Confirms the Add-back, which replaces the gone identity in one exact transaction. */
  function confirm(): void {
    void confirmAddBack(effects);
  }

  /** Sends the retained envelope again with the operation id of its first attempt. */
  function retry(): void {
    void retrySceneResourceMutation(effects);
  }

  const proceed: DialogButton = confirming
    ? { label: SCENE_RECOVERY.confirmAddBack, action: confirm }
    : { label: SCENE_RECOVERY.retrySameOperation, action: retry };
  return (
    <Dialog
      id="sceneRecovery"
      className="tangent-map-resource-scene-recovery"
      frameClassName={FRAME_CLASS}
      heading={sceneHeading(recovery)}
      headingId={SCENE_TITLE_ID}
      cause={<SceneCause recovery={recovery} />}
      buttons={[proceed, { label: SCENE_RECOVERY.close, action: close }]}
      onClose={close}
      onBackStep={close}
    >
      {confirming && <TextArea label={SCENE_RECOVERY.lastKnownTarget} value={recovery.target} readOnly selectOnFocus />}
    </Dialog>
  );
}
