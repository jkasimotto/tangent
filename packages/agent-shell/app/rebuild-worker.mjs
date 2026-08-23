import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

const [file, root, log, serverPidText, targetCommit] = process.argv.slice(2);

/** Writes one phase without losing the captured operation facts. */
async function phase(name, extra = {}) {
  const current = await readJsonObject(file);
  if (!current) throw new Error("The rebuild operation record is missing.");
  return writeJsonObject(file, { ...current, ...extra, phase: name, updatedAt: Date.now() });
}

/** Runs the workspace build with output in the durable diagnosis log. */
async function build() {
  const output = await open(log, "a");
  await output.write(`\n[${new Date().toISOString()}] rebuild ${targetCommit}\n`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build"], { cwd: root, stdio: ["ignore", output.fd, output.fd] });
    child.once("error", reject);
    child.once("close", resolve);
  });
  await output.close();
  if (code !== 0) throw new Error(`npm run build exited with status ${code}. Read ${log}.`);
}

try {
  await build();
  await phase("restarting", { buildFinishedAt: Date.now() });
  process.kill(Number(serverPidText), "SIGTERM");
} catch (error) {
  await phase("failed", { finishedAt: Date.now(), error: String(error?.message ?? error) }).catch(() => {});
  process.exitCode = 1;
}
