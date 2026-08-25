/** Reads one complete projection and waits for every sibling request to settle. */
export async function readProjection(api) {
  const results = await Promise.allSettled([
    api("/api/vault"),
    api("/api/sessions"),
    api("/api/programs"),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}

/** Serializes projection refreshes and keeps at most one trailing refresh. */
export function createRefreshCoordinator(run, environment = globalThis) {
  let active = null;
  let pending = false;
  let pendingOptions = {};
  let retryTimer = null;
  let scheduled = null;
  let stopped = false;

  /** Keeps the stronger initial-load request when triggers overlap. */
  function mergeOptions(current, next) {
    return { ...current, ...next, initial: Boolean(current?.initial || next?.initial) };
  }

  /** Schedules one retry that absorbs every trigger received before it runs. */
  function schedule(options, delay) {
    if (scheduled) {
      scheduled.options = mergeOptions(scheduled.options, options);
      return scheduled.promise;
    }
    let resolveScheduled;
    let rejectScheduled;
    const promise = new Promise((resolve, reject) => {
      resolveScheduled = resolve;
      rejectScheduled = reject;
    });
    scheduled = { options, promise, resolve: resolveScheduled, reject: rejectScheduled };
    retryTimer = environment.setTimeout(() => {
      const next = scheduled;
      retryTimer = null;
      scheduled = null;
      void request(next.options).then(next.resolve, next.reject);
    }, delay);
    return promise;
  }

  /** Starts one refresh or joins the current refresh. */
  function request(options = {}) {
    if (stopped) return Promise.resolve();
    if (active) {
      pending = true;
      pendingOptions = mergeOptions(pendingOptions, options);
      return active;
    }
    if (scheduled) return schedule(options, 0);
    active = Promise.resolve().then(() => run(options));
    active.then((result) => {
      const delay = Number(result?.retryAfterMs);
      const retryDelay = Number.isFinite(delay) && delay >= 0 ? delay : null;
      active = null;
      if (stopped) return;
      if (pending) {
        const nextOptions = pendingOptions;
        pending = false;
        pendingOptions = {};
        void schedule(nextOptions, retryDelay ?? 0);
        return;
      }
      if (retryDelay === null) return;
      void schedule({ trigger: "retry" }, retryDelay);
    }, () => {
      active = null;
      if (!pending || stopped) return;
      const nextOptions = pendingOptions;
      pending = false;
      pendingOptions = {};
      void schedule(nextOptions, 0);
    });
    return active;
  }

  return {
    request,
    /** Stops pending and delayed refresh work. */
    stop() {
      stopped = true;
      pending = false;
      if (retryTimer !== null) environment.clearTimeout?.(retryTimer);
      scheduled?.resolve();
      scheduled = null;
      retryTimer = null;
    },
  };
}

/** Connects pushed invalidations and a slow recovery timer to one refresh function. */
export function startRefreshLifecycle(refresh, environment = globalThis, eventStreamChanged = () => {}) {
  let events = null;
  if (typeof environment.EventSource === "function") {
    events = new environment.EventSource("/api/events");
    events.addEventListener("open", () => eventStreamChanged("open"));
    events.addEventListener("error", () => eventStreamChanged("retrying"));
    events.addEventListener("changed", () => void refresh({ trigger: "event" }));
  }
  else eventStreamChanged("unavailable");
  const timer = environment.setInterval(() => void refresh({ trigger: "timer" }), 30_000);
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
