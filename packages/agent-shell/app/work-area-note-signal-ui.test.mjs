// The Area note signal (`<n> lines · Current <d> days old`) is a note-hygiene
// reminder for the brain's memory file. It shows on the Area page and never
// on Work (work-screen-refresh D1). The server keeps computing `noteSignal`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootWorkTable } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Work prints no note signal on an Area header; the Area page still does", async () => {
  const fixture = workTableFixture();
  fixture.vault.areas = fixture.vault.areas.map((area) => {
    if (area.path === "otto/tangent") return { ...area, noteSignal: { text: "38 lines · Current 3 days old", warning: false } };
    if (area.path === "otto/standards") return { ...area, noteSignal: { text: "120 lines · Current 20 days old", warning: true } };
    return area;
  });
  const { document } = await bootWorkTable(fixture);
  assert.equal(document.querySelector(".work-table .area-note-signal, .work-table .work-group-note"), null, "no header row prints the signal");
  assert.doesNotMatch(document.querySelector(".work-table").textContent, /lines · Current/, "the words never reach Work");

  const areaPage = await readFile(path.join(here, "public", "area-directory-view.js"), "utf8");
  assert.match(areaPage, /area-note-signal/, "the Area page keeps the signal");
});
