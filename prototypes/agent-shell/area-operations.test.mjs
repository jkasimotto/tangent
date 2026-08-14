import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArea, moveArea, previewAreaMove } from "./area-operations.mjs";

test("area creation and moves preserve the complete descendant shape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-areas-"));
  try {
    await mkdir(path.join(root, "neara"));
    const parent = await createArea({ treesRoot: root, parent: "neara", name: "Hackathon" });
    assert.equal(parent.area, "neara/hackathon");
    await createArea({ treesRoot: root, parent: parent.area, name: "Live edit" });
    await writeFile(path.join(root, parent.area, "hackathon.md"), "# Hackathon\n", "utf8");

    const preview = await previewAreaMove({ treesRoot: root, area: parent.area, parent: "neara", name: "Demo event" });
    assert.deepEqual(preview.changedPaths, [
      { from: "neara/hackathon", to: "neara/demo-event" },
      { from: "neara/hackathon/live-edit", to: "neara/demo-event/live-edit" },
    ]);

    const moved = await moveArea({
      treesRoot: root,
      area: parent.area,
      parent: "neara",
      name: "Demo event",
      /** Uses the filesystem fallback in this isolated vault. */
      runGit: async (_args, fallback) => fallback(),
    });
    assert.equal(moved.destination, "neara/demo-event");
    assert.match(await readFile(path.join(root, "neara/demo-event/demo-event.md"), "utf8"), /Hackathon/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
