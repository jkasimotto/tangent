/** Returns Agent Shell's stable top-level DOM elements. */
export function shellDom(document = globalThis.document) {
  const ids = [
    "screen", "back-button", "work-tab", "areas-tab", "prompts-tab", "bar-context", "find-button", "secondary-action",
    "modal-layer", "modal-kicker", "modal-title", "modal-copy", "modal-field", "modal-actions", "toast",
    "cost-readout", "cost-amount", "cost-breakdown", "status-pill", "awake-button", "shell-menu", "go-to-button", "go-to-layer", "go-to-input", "go-to-list",
    "session-layer", "session-layer-title", "session-layer-terminal", "document-peek-layer",
    "work-search", "work-search-input", "work-search-count", "work-search-keys",
  ];
  return Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
}
