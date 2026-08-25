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
function trigger(session, paused = false) {
  return {
    id: "trigger:neara/pgande:rebase", type: "trigger", area: "neara/pgande", name: "rebase", label: "Rebase",
    command: "./probe", probe: "./probe", instructions: "RUN.md", every: "1d", paused, runtime: {},
    cwd: "/repo", sessionName: "trigger-pgande--rebase-1234abcd", session, available: true,
  };
}

/** Builds one live trigger session record. */
function liveSession() {
  return { name: "trigger-pgande--rebase-1234abcd", state: "running" };
}

test("a live trigger offers Stop on every surface that shows it", () => {
  const live = trigger(liveSession());
  const { programRowControls, renderProgramDetail, renderProgramSession } = view([live]);
  assert.deepEqual(programRowControls(live), [{ action: "stop", label: "Stop" }, { action: "pause", label: "Pause" }]);
  const detail = renderProgramDetail(live);
  assert.match(detail, /data-program-action="stop"/);
  assert.doesNotMatch(detail, /data-program-action="check"/);
  assert.match(renderProgramSession(live), /data-program-action="stop"/);
});

test("a waiting trigger offers Check now and no Stop", () => {
  const waiting = trigger(null);
  const { programRowControls, renderProgramDetail, renderProgramSession } = view([waiting]);
  assert.deepEqual(programRowControls(waiting), [{ action: "check", label: "Check now" }, { action: "pause", label: "Pause" }]);
  const detail = renderProgramDetail(waiting);
  assert.match(detail, /data-program-action="check"/);
  assert.doesNotMatch(detail, /data-program-action="stop"/);
  assert.doesNotMatch(renderProgramSession(waiting), /data-program-action="stop"/);
});

test("a running trigger offers Pause on every surface that shows it", () => {
  const live = trigger(liveSession());
  const { renderProgramDetail, renderProgramSession } = view([live]);
  assert.match(renderProgramDetail(live), /data-program-action="pause"/);
  assert.match(renderProgramSession(live), /data-program-action="pause"/);
});

test("a paused trigger offers Resume instead of Pause or Check now", () => {
  const paused = trigger(null, true);
  const { programRowControls, renderProgramDetail, renderProgramSession, programState } = view([paused]);
  assert.deepEqual(programRowControls(paused), [{ action: "resume", label: "Resume" }]);
  assert.equal(programState(paused), "Paused");
  const detail = renderProgramDetail(paused);
  assert.match(detail, /data-program-action="resume"/);
  assert.doesNotMatch(detail, /data-program-action="pause"/);
  assert.doesNotMatch(detail, /data-program-action="check"/);
  assert.match(renderProgramSession(paused), /data-program-action="resume"/);
});

test("a paused trigger with a live agent still offers Stop and says both facts", () => {
  const live = trigger(liveSession(), true);
  const { programRowControls, programState } = view([live]);
  assert.deepEqual(programRowControls(live), [{ action: "stop", label: "Stop" }, { action: "resume", label: "Resume" }]);
  assert.equal(programState(live), "Agent running · Paused");
});

test("a process row is unchanged by the Trigger pause controls", () => {
  const process = {
    id: "process:otto/tangent:hmr", type: "process", area: "otto/tangent", name: "hmr", label: "HMR",
    command: "npm run dev", cwd: "/repo", sessionName: "process-tangent--hmr-1234abcd", session: null, available: true,
  };
  const { programRowControls, renderProgramDetail } = view([process]);
  assert.deepEqual(programRowControls(process), [{ action: "start", label: "Start" }]);
  assert.doesNotMatch(renderProgramDetail(process), /data-program-action="pause"/);
});
