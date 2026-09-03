// The one component that renders a registered surface. It reads the registry row for its id and
// does what the row says: a backdrop and `role="dialog"` with `aria-modal` when modal, a `region`
// otherwise; focus moved to the declared target on open; focus returned to the opener on close;
// Tab kept inside while modal. Feature surfaces render inside it and receive `close` and
// `backStep`. Nothing outside `ui/` renders a dialog, a backdrop, or calls `.focus()`.

import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { surfaceDeclaration } from "../surfaces/surface-registry.ts";
import type { SurfaceFocusOnOpen, SurfaceId } from "../surfaces/surface-registry.ts";

/** The two things a surface can ask of the stack, handed to its children. */
export interface SurfaceControls {
  readonly close: () => void;
  readonly backStep: () => void;
}

/** Children are a plain node or a function that receives the surface's controls. */
export type SurfaceChildren = ReactNode | ((controls: SurfaceControls) => ReactNode);

export interface SurfaceProps {
  readonly id: SurfaceId;
  /** The class the browser suites select the surface by, such as `tangent-map-picker`. */
  readonly className: string;
  /** The class of the wrapping frame. When the surface is modal this frame is the backdrop. */
  readonly frameClassName?: string | undefined;
  /** Overrides the registry's modality, for a panel that becomes a sheet at narrow widths. */
  readonly modal?: boolean | undefined;
  /** The role of a non-modal surface when `region` is not the right one: Find is a `search`, the placement bar a `status`. A modal surface is always a dialog. */
  readonly role?: "search" | "status" | undefined;
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  /** The element focus returns to on close. Defaults to the element focused when the surface opened. */
  readonly opener?: HTMLElement | null | undefined;
  /**
   * A selector for the control focus lands on when the registry says `first-control` and the first
   * focusable element is not the right one, such as the Outline's first tree item behind its Close
   * button. Falls back to the first focusable element when nothing matches.
   */
  readonly initialFocus?: string | undefined;
  /** Kit-only inline style, such as the panel width token. */
  readonly style?: CSSProperties | undefined;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
  readonly children: SurfaceChildren;
}

/** The backdrop class of a modal surface that names no frame of its own. */
const DEFAULT_BACKDROP_CLASS = "tangent-map-dialog-backdrop";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])",
  "a[href]", '[tabindex]:not([tabindex="-1"])'
].join(", ");

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** Renders one registered surface. */
export function Surface(props: SurfaceProps): ReactNode {
  const declaration = surfaceDeclaration(props.id);
  const modal = props.modal ?? declaration.modality === "modal";
  const sectionRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null | undefined>(props.opener);
  openerRef.current = props.opener;

  useEffect(
    /** Moves focus in on open and back out on close, as the registry row declares. */
    () => {
      const section = sectionRef.current;
      if (section === null) return undefined;
      const opener = openerRef.current ?? activeHtmlElement();
      const frame = requestAnimationFrame(() => moveFocusIn(section, declaration.focusOnOpen, props.initialFocus));
      return () => {
        cancelAnimationFrame(frame);
        if (declaration.restoreFocus) restoreFocusTo(opener);
      };
    },
    [props.id, declaration, props.initialFocus]
  );

  /** Keeps Tab inside a modal surface. Escape is the keyboard dispatcher's, through the stack. */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (modal) trapTab(event);
  }

  const controls: SurfaceControls = { close: props.onClose, backStep: props.onBackStep };
  const section = (
    <section
      ref={sectionRef}
      className={props.className}
      role={modal ? "dialog" : props.role ?? "region"}
      aria-modal={modal ? "true" : undefined}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      tabIndex={-1}
      style={props.style}
      onKeyDown={handleKeyDown}
    >
      {typeof props.children === "function" ? props.children(controls) : props.children}
    </section>
  );
  const frameClassName = props.frameClassName ?? (modal ? DEFAULT_BACKDROP_CLASS : undefined);
  if (frameClassName === undefined) return section;
  return <div className={frameClassName} data-tangent-backdrop={modal ? "true" : undefined}>{section}</div>;
}

/** The focused element when it is an HTML element, else null. */
function activeHtmlElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/** Every element inside the surface that Tab can reach. */
function focusableInside(section: HTMLElement): HTMLElement[] {
  return [...section.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

/**
 * Puts focus where the surface asked, then where the registry row says, falling back to the
 * surface itself. An `initialFocus` selector that matches wins over the declared target, which is
 * how the Resources panel returns focus to the row control a Show or a cancelled placement left.
 */
function moveFocusIn(section: HTMLElement, target: SurfaceFocusOnOpen, initialFocus: string | undefined): void {
  if (target === "none") return;
  const preferred = preferredControlOf(section, initialFocus);
  const declared = target === "heading" ? headingOf(section) : focusableInside(section)[0] ?? null;
  (preferred ?? declared ?? section).focus({ preventScroll: true });
}

/** The element the surface named through `initialFocus`, when it named one and it is inside. */
function preferredControlOf(section: HTMLElement, initialFocus: string | undefined): HTMLElement | null {
  return initialFocus === undefined ? null : section.querySelector<HTMLElement>(initialFocus);
}

/** The surface's first heading, made focusable so a screen reader lands on the title. */
function headingOf(section: HTMLElement): HTMLElement | null {
  const heading = section.querySelector<HTMLElement>(HEADING_SELECTOR);
  if (heading !== null && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

/**
 * Returns focus to the opener when it is still in the document. It waits one frame, because a modal
 * surface makes the canvas inert while it is open and an inert element refuses focus: the guard is
 * lifted in the same commit that unmounts the surface, and the frame puts the restore after it.
 */
function restoreFocusTo(opener: HTMLElement | null): void {
  if (opener === null) return;
  requestAnimationFrame(() => {
    if (opener.isConnected) opener.focus({ preventScroll: true });
  });
}

/** Wraps Tab and Shift-Tab around the surface's focusable elements. */
function trapTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const section = event.currentTarget;
  const focusable = focusableInside(section);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    section.focus({ preventScroll: true });
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
