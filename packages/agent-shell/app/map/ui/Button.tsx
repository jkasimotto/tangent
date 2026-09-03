// The Map's button. Every clickable control outside Excalidraw renders through here, so a feature
// never writes a raw <button> and never forgets type="button" inside a form.
//
// The glyph and label spans carry the classes map.css uses to swap between the wide and the narrow
// toolbar: `tangent-map-glyph` is hidden on a wide Map and shown on a narrow one, `tangent-map-label`
// the reverse. The kbd hint names the key that does the same thing from the canvas.

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

/** The native attributes a feature may still pass: id, className, title, disabled, aria-* and so on. */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick" | "onKeyDown" | "onKeyUp" | "style" | "children" | "dangerouslySetInnerHTML"
>;

export type ButtonProps = NativeButtonProps & {
  /** Defaults to "button" so a button inside a form never submits it by accident. */
  readonly type?: "button" | "submit";
  /** The visible name, rendered in a span with the class tangent-map-label. */
  readonly label?: string;
  /** A one-character icon, hidden from assistive technology, in a span with the class tangent-map-glyph. */
  readonly glyph?: string;
  /**
   * When the glyph shows. `narrow` (the default) shows it only on a narrow Map, where the label is
   * hidden. `always` keeps it beside the label on a wide Map too, as the Block button does.
   */
  readonly glyphVisibility?: "narrow" | "always";
  /** The key that does the same thing from the canvas, rendered as a <kbd> hint. */
  readonly kbd?: string;
  /** Extra content after the label, for the rare button whose content is not one word. */
  readonly children?: ReactNode;
  /** data-* attributes, keyed without the data- prefix, for the browser suites' selectors. */
  readonly data?: Readonly<Record<string, string>>;
  /** What the button does. Receives the event so an opener can be remembered for focus restore. */
  readonly onActivate?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/** Expands a `data` record into data-* attributes. */
function dataAttributes(data: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) attributes[`data-${key}`] = value;
  return attributes;
}

/** A button with an optional glyph, label and key hint. Type is "button" unless told otherwise. */
export function Button({ type, label, glyph, glyphVisibility, kbd, children, data, onActivate, ...native }: ButtonProps): ReactNode {
  return (
    <button type={type ?? "button"} {...native} {...dataAttributes(data)} onClick={onActivate}>
      {glyph !== undefined && (
        <span aria-hidden="true" className={glyphVisibility === "always" ? undefined : "tangent-map-glyph"}>
          {glyph}
        </span>
      )}
      {label !== undefined && <span className="tangent-map-label">{label}</span>}
      {children}
      {kbd !== undefined && <kbd>{kbd}</kbd>}
    </button>
  );
}
