import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (!isMainThread) {
  let lastHeartbeat = Date.now();
  parentPort.on("message", () => { lastHeartbeat = Date.now(); });
  const checkMs = Math.max(100, Math.floor(workerData.timeoutMs / 4));
  setInterval(() => {
    if (Date.now() - lastHeartbeat <= workerData.timeoutMs) return;
    process.kill(process.pid, "SIGTERM");
  }, checkMs);
}

/** Starts an out-of-band event-loop heartbeat monitor for this process. */
export function startEventLoopWatchdog({ timeoutMs = 15_000, heartbeatMs = 1_000 } = {}) {
  const execArgv = process.execArgv.filter((argument) => !argument.startsWith("--input-type"));
  const worker = new Worker(new URL(import.meta.url), { workerData: { timeoutMs }, execArgv });
  const heartbeat = setInterval(() => worker.postMessage("heartbeat"), heartbeatMs);
  heartbeat.unref();
  worker.unref();
  /** Stops the monitor during an intentional graceful shutdown. */
  async function close() {
    clearInterval(heartbeat);
    await worker.terminate();
  }
  return { close };
}
