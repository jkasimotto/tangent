/** Creates one non-overlapping scheduler for Agent Shell's background work. */
export function createRuntimeScheduler(tasks, tickMs = 1000) {
  let timer = null;
  const running = new Set();
  const lastRun = new Map();

  /** Runs due task lanes concurrently while each named lane stays serial. */
  async function tick() {
    const now = Date.now();
    const due = tasks.filter((task) => task.active() && !running.has(task.name) && now - (lastRun.get(task.name) ?? 0) >= task.intervalMs);
    await Promise.all(due.map(async (task) => {
      running.add(task.name);
      lastRun.set(task.name, now);
      try {
        await task.run();
      } catch (error) {
        console.error(`${task.name}:`, error?.message ?? error);
      } finally {
        running.delete(task.name);
      }
    }));
    if (!tasks.some((task) => task.active()) && running.size === 0) stop();
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
