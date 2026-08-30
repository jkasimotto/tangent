import assert from "node:assert/strict";
import test from "node:test";
import { brainAttemptAuthority, inactiveBrainAuthorityState } from "./brain-authority.mjs";

const record = { area: "otto/hedno", session: "hedno-brain-g2", currentAttemptId: "hedno-brain-g2", generation: 2, instanceId: "shell-one", generations: [{ generation: 2, session: "hedno-brain-g2", instanceId: "shell-one", target: "$22" }] };
const live = { name: "hedno-brain-g2", target: "$22", instanceId: "shell-one", owned: true, kind: "brain", area: "otto/hedno", brain: "otto/hedno", generation: 2, observedAt: Date.parse("2026-08-30T06:00:00Z") };

test("only the exact fresh brain attempt is authoritative", () => {
  assert.equal(brainAttemptAuthority(record, live, { instanceId: "shell-one" }).live, true);
  for (const changed of [
    { target: "$replacement" }, { instanceId: "shell-two" }, { generation: 1 },
    { kind: "repair" }, { brain: "otto/other", area: "otto/other" }, { fresh: false },
  ]) assert.equal(brainAttemptAuthority(record, { ...live, ...changed }, { instanceId: "shell-one" }).live, false);
});

test("fresh absence projects stopped state with exact tmux evidence", () => {
  const authority = brainAttemptAuthority(record, null, { instanceId: "shell-one", now: Date.parse("2026-08-30T06:01:00Z") });
  const state = inactiveBrainAuthorityState(authority);
  assert.equal(state.word, "Brain stopped");
  assert.equal(state.evidence.source, "tmux observation");
  assert.match(state.evidence.text, /hedno-brain-g2 at \$22/);
});

test("absence names the expected session, target, generation, and capture time", () => {
  const result = brainAttemptAuthority(record, null, { instanceId: "shell-one", now: Date.parse("2026-08-30T06:01:00Z") });
  assert.equal(result.state, "absent");
  assert.deepEqual(result.evidence.expected, { session: "hedno-brain-g2", target: "$22", instanceId: "shell-one", area: "otto/hedno", generation: 2 });
  assert.equal(result.evidence.observedAt, "2026-08-30T06:01:00.000Z");
});
