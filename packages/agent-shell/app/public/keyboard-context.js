/**
 * Resolves the one visible surface that owns a keyboard event.
 *
 * The function accepts facts instead of DOM nodes so layer priority can be
 * proved without a browser. Callers may still choose to leave a key native;
 * ownership means only that no lower Agent Shell surface may interpret it.
 */
export function resolveKeyboardContext({
  goTo = false,
  modal = false,
  documentPeek = false,
  session = false,
  focusPicker = false,
  transient = false,
  textEntry = false,
  view = "",
} = {}) {
  if (modal) return "modal";
  if (goTo) return "go-to";
  if (documentPeek) return "document-peek";
  if (session) return "session";
  if (transient) return "transient";
  if (focusPicker) return "focus-picker";
  if (textEntry) return "text-entry";
  if (view === "work") return "work";
  if (view === "document") return "document";
  return "screen";
}

/** True when a key belongs to an IME or an unfinished keyboard composition. */
export function keyboardEventIsComposing(event) {
  return Boolean(event?.isComposing)
    || ["Dead", "Process", "Unidentified"].includes(String(event?.key ?? ""));
}
