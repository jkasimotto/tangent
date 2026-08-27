import assert from "node:assert/strict";
import test from "node:test";
import { createProgramView } from "./public/program-view.js";

/** Builds the program view with the stubs its row and detail helpers need. */
function view(programs) {
  return createProgramView({
    state: { programs: { operations: programs, areas: [] }, programId: programs[0]?.id ?? "" },
    /** Names one area for a heading. */
    areaLabel: (area) => area,
    /** Renders one area breadcrumb. */
    areaPath: () => "",
    /** Names one person. */
    humanName: () => "Julian",
    /** Names one agent. */
    agentName: () => "Claude",
    /** Lists selectable areas. */
    areaOptions: () => "",
  });
}

/** Builds one service record; the stored kind stays `process` (D19). */
function service(session) {
  return {
    id: "process:otto/tangent:hmr", type: "process", area: "otto/tangent", name: "hmr", label: "HMR",
    command: "npm run dev", cwd: "/repo", sessionName: "process-tangent--hmr-1234abcd", session, available: true,
  };
}

test("a stopped service offers Start and reads as a Service", () => {
  const stopped = service(null);
  const { programRowControls, renderProgramDetail, programKind } = view([stopped]);
  assert.deepEqual(programRowControls(stopped), [{ action: "start", label: "Start" }]);
  assert.equal(programKind(stopped), "Service");
  const detail = renderProgramDetail(stopped);
  assert.match(detail, /data-program-action="start"/);
  assert.doesNotMatch(detail, /data-program-action="pause"/);
  assert.doesNotMatch(detail, /Trigger/);
});

test("a live service offers Stop on every surface that shows it", () => {
  const live = service({ name: "process-tangent--hmr-1234abcd", state: "running" });
  const { programRowControls, renderProgramDetail, renderProgramSession, programState } = view([live]);
  assert.deepEqual(programRowControls(live), [{ action: "stop", label: "Stop" }]);
  assert.equal(programState(live), "Running");
  assert.match(renderProgramDetail(live), /data-program-action="stop"/);
  assert.match(renderProgramSession(live), /data-program-action="stop"/);
});
