// The save status island at the bottom right, left of Excalidraw's help button. It reads the
// controller's save state and draft through `save-status-model.ts` and renders the answer: the
// words, the state class map.css colours by, and the way out of a refused save as buttons. It is a
// `role="status"` island, not a registered surface: it never takes focus and Escape never reaches it.

import type { ReactNode } from "react";
import { SAVE } from "../../copy.ts";
import type { DraftRecord, SaveStatus as SaveState } from "../../kernel/kernel-types.ts";
import { Button } from "../../ui/Button.tsx";
import { saveStatusView } from "./save-status-model.ts";
import type { SaveAction, SaveActionButton } from "./save-status-model.ts";

export type SaveStatusProps = {
  readonly status: SaveState;
  readonly draft: DraftRecord | null;
  /** Runs one way out of a refused save; `save-effects.ts` has `recoverMap` for it. */
  readonly onRecover: (action: SaveAction) => void;
};

/** Renders the island for the controller's save state. */
export function SaveStatus(props: SaveStatusProps): ReactNode {
  const view = saveStatusView(props.status, props.draft);

  /** Renders one recovery button. */
  function renderButton(button: SaveActionButton): ReactNode {
    return <Button key={button.action} label={button.label} onActivate={() => props.onRecover(button.action)} />;
  }

  return (
    <div className={view.className} role="status" aria-live="polite" aria-label={SAVE.statusName}>
      {view.text}
      {view.buttons.map(renderButton)}
    </div>
  );
}
