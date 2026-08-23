/** Connects pushed invalidations and a slow recovery timer to one refresh function. */
export function startRefreshLifecycle(refresh, environment = globalThis) {
  let events = null;
  if (typeof environment.EventSource === "function") {
    events = new environment.EventSource("/api/events");
    events.addEventListener("changed", () => void refresh());
  }
  const timer = environment.setInterval(() => void refresh(), 30_000);
  return {
    /** Stops both refresh mechanisms. */
    stop() {
      events?.close();
      environment.clearInterval?.(timer);
    },
  };
}

/** Checks an active rebuild quickly enough to make restart progress legible. */
export function startRebuildRefresh(active, refresh, environment = globalThis) {
  const timer = environment.setInterval(() => {
    if (active()) void refresh();
  }, 750);
  return {
    /** Stops the active-operation timer. */
    stop() { environment.clearInterval?.(timer); },
  };
}
