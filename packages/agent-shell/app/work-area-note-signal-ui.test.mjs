// The Area note signal (`<n> lines · Current <d> days old`) shows on the
// Area header row in Work, muted, and in warning style past 100 lines or 14
// days. The server computes it once with `noteSignal`; the browser renders it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

/** Reads the note signal rendered on one Area header row. */
function headerSignal(document, area) {
  return document.querySelector(`.work-group-row[data-work-area='${area}'] .work-group-note`);
}

test("the Area header row shows the note signal, warning when the note is long or stale", async () => {
  const fixture = workTableFixture();
  fixture.vault.areas = fixture.vault.areas.map((area) => {
    if (area.path === "otto/tangent") return { ...area, noteSignal: { text: "38 lines · Current 3 days old", warning: false } };
    if (area.path === "otto/standards") return { ...area, noteSignal: { text: "120 lines · Current 20 days old", warning: true } };
    return area;
  });
  const { window, document } = await bootWorkTable(fixture);
  const calm = headerSignal(document, "otto/tangent");
  assert.equal(calm?.textContent, "38 lines · Current 3 days old");
  assert.equal(calm.classList.contains("warning"), false);
  const warned = headerSignal(document, "otto/standards");
  assert.equal(warned?.textContent, "120 lines · Current 20 days old");
  assert.ok(warned.classList.contains("warning"), "a long or stale note warns");
  assert.equal(headerSignal(document, "otto/onboarding"), null, "no signal, no element");
  window.close();
});
