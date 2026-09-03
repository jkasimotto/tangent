// The Map keys dialog: the `help` surface of the registry, modal on the dialog layer, focus on its
// heading, closed by Escape or its Close button, focus returned to the opener. Every sentence comes
// from `copy/help.ts` and every key inside a sentence is set by `ui/KeyedSentence.tsx`, so this file
// holds no words and no markup of its own beyond the paragraphs.

import type { ReactNode } from "react";
import { HELP } from "../../copy.ts";
import { Button } from "../../ui/Button.tsx";
import { KeyedSentence } from "../../ui/KeyedSentence.tsx";
import { Surface } from "../../ui/Surface.tsx";

export type HelpProps = {
  /** The control that opened the dialog, so focus returns to it on close. */
  readonly opener?: HTMLElement | null | undefined;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
};

/** The id the dialog is labelled by. The world suite names the dialog through it. */
const TITLE_ID = "tangent-map-help-title";
const CLASS_NAME = "tangent-map-help";

/** Renders the keys dialog. */
export function Help(props: HelpProps): ReactNode {
  return (
    <Surface
      id="help"
      className={CLASS_NAME}
      labelledBy={TITLE_ID}
      opener={props.opener}
      onClose={props.onClose}
      onBackStep={props.onBackStep}
    >
      <h2 id={TITLE_ID}>{HELP.title}</h2>
      <p><KeyedSentence parts={HELP.toolSentence()} /></p>
      <p><KeyedSentence parts={HELP.find} /></p>
      <p>{HELP.canvas}</p>
      <p><KeyedSentence parts={HELP.brain} /></p>
      <p><KeyedSentence parts={HELP.selected} /></p>
      <Button label={HELP.close} onActivate={props.onClose} />
    </Surface>
  );
}
