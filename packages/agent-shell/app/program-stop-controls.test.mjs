import assert from "node:assert/strict";
import test from "node:test";
import { createProgramView } from "./public/program-view.js";

/** Builds the program view with the stubs its row and detail helpers need. */
function view(programs) {
  return createProgramView({
    state: { programs: { programs, areas: [] }, programId: programs[0]?.id ?? "" },
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

/** Builds one trigger program record. */
function trigger(session) {
  return {
    id: "trigger:neara/pgande:rebase", type: "trigger", area: "neara/pgande", name: "rebase", label: "Rebase",
    command: "./probe", probe: "./probe", instructions: "RUN.md", every: "1d", paused: false, runtime: {},
    cwd: "/repo", sessionName: "trigger-pgande--rebase-1234abcd", session, available: true,
  };
}

test("a live trigger offers Stop on every surface that shows it", () => {
  const live = trigger({ name: "trigger-pgande--rebase-1234abcd", state: "running" });
  const { programRowControl, renderProgramDetail, renderProgramSession } = view([live]);
  assert.deepEqual(programRowControl(live), { action: "stop", label: "Stop" });
  const detail = renderProgramDetail(live);
  assert.match(detail, /data-program-action="stop"/);
  assert.doesNotMatch(detail, /data-program-action="check"/);
  assert.match(renderProgramSession(live), /data-program-action="stop"/);
});

test("a waiting trigger offers Check now and no Stop", () => {
  const waiting = trigger(null);
  const { programRowControl, renderProgramDetail, renderProgramSession } = view([waiting]);
  assert.deepEqual(programRowControl(waiting), { action: "check", label: "Check now" });
  const detail = renderProgramDetail(waiting);
  assert.match(detail, /data-program-action="check"/);
  assert.doesNotMatch(detail, /data-program-action="stop"/);
  assert.doesNotMatch(renderProgramSession(waiting), /data-program-action="stop"/);
});
