import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { managedProcessSession, programsSnapshot, saveLocalProgram, saveRoutine, setRoutinePaused } from "./programs.mjs";

test("Programs groups managed processes, commands, and daily agents with their areas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-programs-"));
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-shell-program-repo-"));
  const sidecar = path.join(root, "sidecar.json");
  const area = path.join(root, "otto", "dnd");
  try {
    await mkdir(area, { recursive: true });
    await writeFile(path.join(area, "dnd.md"), `# D&D\n\n## Resources\n\n- Repository: ${repo}\n`, "utf8");
    await writeFile(path.join(area, ".processes.json"), '{"scripts":{"hmr":"npm run dev:hmr"}}\n', "utf8");
    await saveLocalProgram({ treesRoot: root, area: "otto/dnd", type: "command", name: "Release", command: "npm run release", cwd: repo });
    const routine = await saveRoutine({ treesRoot: root, area: "otto/dnd", name: "Daily check", time: "07:30", cwd: repo, model: "sonnet", prompt: "Check the area and leave proof." });
    await writeFile(sidecar, JSON.stringify({ recur: { "daily-check": { lastRunAt: "2026-08-12T04:30:00.000Z" } } }), "utf8");

    const sessionName = managedProcessSession("otto/dnd", "hmr");
    const snapshot = await programsSnapshot({
      treesRoot: root,
      sidecarFile: sidecar,
      sessions: [{ name: sessionName, kind: "process", area: "otto/dnd", process: "hmr", state: "service" }],
    });
    assert.deepEqual(snapshot.programs.map((program) => program.type), ["process", "routine", "command"]);
    assert.equal(snapshot.programs.find((program) => program.name === "hmr").sessionName, sessionName);
    assert.equal(snapshot.programs.find((program) => program.name === "daily-check").lastRunAt, "2026-08-12T04:30:00.000Z");
    assert.equal(snapshot.liveCount, 1);

    await setRoutinePaused({ treesRoot: root, source: routine.file, paused: true });
    assert.match(await readFile(path.join(root, routine.file), "utf8"), /^paused: true$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});
