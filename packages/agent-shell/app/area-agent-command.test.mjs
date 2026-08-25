import assert from "node:assert/strict";
import test from "node:test";

import { areaAncestors, noteResource } from "./area-agent-command.mjs";

test("walks area paths from the nearest area to the root", () => {
  assert.deepEqual(areaAncestors("otto/dnd/campaign"), ["otto/dnd/campaign", "otto/dnd", "otto"]);
});

test("reads a labelled line only from Resources", () => {
  const note = "# D&D\n\nRepository: ignored\n\n## Resources\n\n- Repository: ~/dnd\n\n## Notes\n";
  assert.equal(noteResource(note, "Repository"), "~/dnd");
});
