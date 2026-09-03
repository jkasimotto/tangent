/** Returns Agent Shell's stable top-level DOM elements. */
export function shellDom(document = globalThis.document) {
  const ids = [
    "screen", "back-button", "map-tab", "work-tab", "areas-tab", "prompts-tab", "bar-context", "find-button", "secondary-action",
    "for-you-button", "problems-button", "context-brain-button",
    "modal-layer", "modal-kicker", "modal-title", "modal-copy", "modal-field", "modal-actions", "toast",
    "status-pill", "awake-button", "shell-menu", "go-to-button", "go-to-layer", "go-to-input", "go-to-list",
    "work-lens-layer", "work-lens-content", "work-lens-title", "work-lens-freshness",
    "session-layer", "session-layer-title", "session-layer-terminal", "document-peek-layer",
    "work-search", "work-search-input", "work-search-count", "work-search-keys",
  ];
  return Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
}
