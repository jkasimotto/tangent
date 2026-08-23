/** Creates one non-overlapping scheduler for Agent Shell's background work. */
export function createRuntimeScheduler(tasks, tickMs = 1000) {
  let timer = null;
  let running = false;
  const lastRun = new Map();

  /** Runs every due active task once without overlap. */
  async function tick() {
    if (running) return;
    running = true;
    const now = Date.now();
    try {
      for (const task of tasks) {
        if (!task.active() || now - (lastRun.get(task.name) ?? 0) < task.intervalMs) continue;
        lastRun.set(task.name, now);
        try {
          await task.run();
        } catch (error) {
          console.error(`${task.name}:`, error?.message ?? error);
        }
      }
    } finally {
      running = false;
      if (!tasks.some((task) => task.active())) stop();
    }
  }

  /** Starts the scheduler when background work becomes active. */
  function wake() {
    if (timer) return;
    timer = setInterval(tick, tickMs);
    timer.unref();
    void tick();
  }

  /** Stops the scheduler when no task remains active. */
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { wake, stop, tick };
}
