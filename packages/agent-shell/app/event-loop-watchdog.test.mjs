import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

test("the watchdog terminates a process whose main event loop is blocked", async () => {
  const moduleUrl = new URL("./event-loop-watchdog.mjs", import.meta.url).href;
  const script = `import { startEventLoopWatchdog } from ${JSON.stringify(moduleUrl)};
startEventLoopWatchdog({ timeoutMs: 150, heartbeatMs: 20 });
await new Promise((resolve) => setTimeout(resolve, 40));
const end = Date.now() + 2000;
while (Date.now() < end) { /* deliberate event-loop block */ }
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: "ignore" });
  const [code, signal] = await once(child, "exit");
  assert.equal(code, null);
  assert.equal(signal, "SIGTERM");
});
