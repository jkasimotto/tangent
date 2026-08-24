import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { managedProcessSession, programsSnapshot, saveLocalProgram, triggerSession } from "./programs.mjs";

test("Programs groups managed processes and commands with their areas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-programs-"));
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-shell-program-repo-"));
  const area = path.join(root, "otto", "dnd");
  try {
    await mkdir(area, { recursive: true });
    await writeFile(path.join(area, "dnd.md"), `# D&D\n\n## Resources\n\n- Repository: ${repo}\n`, "utf8");
    await writeFile(path.join(area, ".processes.json"), '{"scripts":{"hmr":"npm run dev:hmr"},"triggers":{"phone":{"every":"5m","probe":"./phone --json","instructions":"PHONE.md"}}}\n', "utf8");
    await saveLocalProgram({ treesRoot: root, area: "otto/dnd", type: "command", name: "Release", command: "npm run release", cwd: repo });
    const sessionName = managedProcessSession("otto/dnd", "hmr");
    const snapshot = await programsSnapshot({
      treesRoot: root,
      sessions: [{ name: sessionName, kind: "process", area: "otto/dnd", process: "hmr", state: "service" }],
    });
    assert.deepEqual(snapshot.programs.map((program) => program.type), ["process", "trigger", "command"]);
    assert.equal(snapshot.programs.find((program) => program.name === "hmr").sessionName, sessionName);
    assert.equal(snapshot.liveCount, 1);
    assert.equal(snapshot.programs.find((program) => program.name === "phone").sessionName, triggerSession("otto/dnd", "phone"));
    assert.equal(snapshot.programs.find((program) => program.name === "phone").every, "5m");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});
