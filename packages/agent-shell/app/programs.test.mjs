import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { managedProcessSession, programsSnapshot, saveLocalProgram, setTriggerPaused, triggerSession } from "./programs.mjs";

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

test("Pause and Resume write the trigger flag and leave the rest of the manifest alone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-pause-"));
  const area = path.join(root, "neara", "pgande");
  const file = path.join(area, ".processes.json");
  const manifest = '{\n  "triggers": {\n    "rebase": {\n      "every": "1d",\n      "probe": "./probe",\n      "instructions": "RUN.md"\n    }\n  }\n}\n';
  try {
    await mkdir(area, { recursive: true });
    await writeFile(file, manifest, "utf8");

    assert.deepEqual(await setTriggerPaused({ treesRoot: root, area: "neara/pgande", name: "rebase", paused: true }), { id: "trigger:neara/pgande:rebase", paused: true });
    const paused = JSON.parse(await readFile(file, "utf8"));
    assert.equal(paused.triggers.rebase.paused, true);
    assert.equal(paused.triggers.rebase.probe, "./probe");
    assert.equal((await programsSnapshot({ treesRoot: root })).programs[0].paused, true);

    await setTriggerPaused({ treesRoot: root, area: "neara/pgande", name: "rebase", paused: false });
    assert.equal(await readFile(file, "utf8"), manifest);
    assert.equal((await programsSnapshot({ treesRoot: root })).programs[0].paused, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pause reports a trigger that no longer exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-pause-missing-"));
  const area = path.join(root, "neara", "pgande");
  try {
    await mkdir(area, { recursive: true });
    await writeFile(path.join(area, ".processes.json"), '{"triggers":{"rebase":{"every":"1d","probe":"./probe","instructions":"RUN.md"}}}\n', "utf8");
    await assert.rejects(setTriggerPaused({ treesRoot: root, area: "neara/pgande", name: "other", paused: true }), /no longer exists/);
    await assert.rejects(setTriggerPaused({ treesRoot: root, area: "neara/hackathon", name: "rebase", paused: true }), /no programs file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
