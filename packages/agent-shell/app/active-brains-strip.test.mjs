import test from "node:test";
import assert from "node:assert/strict";
import { createWorkDeskView } from "./public/work-desk-view.js";

/** No-op collaborator for view behavior this focused renderer does not use. */
function noop() {}

/** Keeps fixture collections in their supplied order. */
function identity(items) { return items; }

/** Builds only the collaborators read while the active-brain strip renders. */
function viewFor(brains) {
  return createWorkDeskView({
    shell: {
      state: { brains, sessions: [], verdictLines: new Set() },
      api: noop, post: noop, paint: noop, refresh: noop, showToast: noop, captureReturnPoint: noop, saveDescribeSession: noop,
    },
    launch: {
      launchSelection: noop, launchRequestFields: noop, syncLaunchDraft: noop, preferredArea: noop, launchOptionsFor: noop,
      pipelineForGoal: noop, pipelineRecordForGoal: noop, launchPopover: noop, DESCRIBE_LAUNCH_TARGET: "describe", BRAIN_LAUNCH_TARGET: "brain",
    },
    areaModel: { areas: noop, orderedGoalTrees: identity },
    programs: { programRowControl: noop, programIsLive: noop, programState: noop, localMoment: noop },
    chrome: { shortcutKbd: noop, whatHappenedOverlay: noop },
  });
}

test("the Work screen lists every live brain as a direct terminal link", () => {
  const html = viewFor([
    { area: "otto/dnd", status: "running", live: true, session: "dnd-brain", generation: 3, state: "working" },
    { area: "otto/tangent", status: "running", live: true, session: "tangent-brain", generation: 1, state: "waiting", stateDetail: "decision" },
    { area: "otto/ended", status: "ended", live: false, session: "ended-brain", generation: 2 },
  ]).activeBrainsStrip();

  assert.match(html, /Active brains/);
  assert.match(html, /data-open-brain="dnd-brain"/);
  assert.match(html, /D&amp;D/);
  assert.match(html, /Generation 3/);
  assert.match(html, /data-open-brain="tangent-brain"/);
  assert.match(html, /needs a decision/);
  assert.doesNotMatch(html, /ended-brain/);
});

test("the Work screen omits the active-brain strip when no brain is live", () => {
  assert.equal(viewFor([{ area: "otto/dnd", status: "stopped", live: false }]).activeBrainsStrip(), "");
});
