const ACTION_ATTRIBUTES = [
  "data-launch-start", "data-launch-for", "data-pipeline-control", "data-open-session",
  "data-open-brain", "data-verdict", "data-reply-subject", "data-goal-action",
  "data-program-action", "data-area-action", "data-modal-confirm", "data-modal-cancel",
  "data-toggle-awake", "data-stop-agent", "data-finish-run", "data-mark-complete",
  "data-mark-wont-do", "data-reopen-goal", "data-action",
  "data-stop-goal", "data-complete-goal", "data-wont-do-goal",
  "data-notify-document-comments",
];

/** Returns a stable action name without labels, typed text, paths, or document content. */
export function actionName(target) {
  const control = target?.closest?.("button, a, summary, [role='button']");
  if (!control) return "";
  for (const attribute of ACTION_ATTRIBUTES) {
    if (!control.hasAttribute(attribute)) continue;
    const value = control.getAttribute(attribute);
    return value && /^(accept|reject|undo|start|stop|restart|pause|resume|run|close|skip|retry|end|next)$/.test(value)
      ? `${attribute.slice(5)}:${value}`
      : attribute.slice(5);
  }
  return control.id ? `id:${control.id}` : control.tagName.toLowerCase();
}

/** Sends anonymous local action records; telemetry never blocks the action. */
export function createActionTelemetry(fetchJson = globalThis.fetch.bind(globalThis), now = () => performance.now()) {
  const fetchFallback = arguments.length ? fetchJson : null;
  const beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator) ?? null;
  /** Posts one fire-and-forget local telemetry record. */
  function record(kind, action, detail = {}) {
    if (!action) return;
    const body = JSON.stringify({ kind, action, ...detail });
    if (beacon) {
      beacon("/api/telemetry/action", body);
      return;
    }
    fetchFallback?.("/api/telemetry/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  /** Observes semantic clicks and form submissions below one root. */
  function observe(root = document) {
    root.addEventListener("click", (event) => record("ui", actionName(event.target)), true);
    root.addEventListener("submit", (event) => {
      const form = event.target;
      const marker = [...(form?.attributes ?? [])].find((attribute) => attribute.name.startsWith("data-") && attribute.name.endsWith("-form"));
      record("ui", marker?.name.slice(5) ?? (form?.id ? `form:${form.id}` : "form"));
    }, true);
  }

  /** Records the completion of one Agent Shell API request. */
  function apiFinished(method, path, startedAt, status, ok) {
    if (path === "/api/telemetry/action") return;
    record("api", `${method} ${String(path).split("?")[0]}`, { durationMs: now() - startedAt, status, ok });
  }

  return { apiFinished, observe, record, start: now };
}

export default { actionName, createActionTelemetry };
