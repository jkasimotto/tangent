import test from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLES, PROMPT_SPECIES, renderPromptBestiary } from "./public/prompt-bestiary.js";

test("the bestiary covers prompts, routing events, and common agent lifecycles", () => {
  assert.deepEqual(PROMPT_SPECIES.map((item) => item.id), ["describe", "goal", "collaborate", "pipeline", "brain", "agent-message", "brain-notice", "verdict", "reply", "context", "voice"]);
  assert.deepEqual(LIFECYCLES.map((item) => item.id), ["solo", "brain-solo", "brain-pipeline", "verdicts"]);
  assert.ok(LIFECYCLES.every((item) => item.steps.length >= 4));
});

test("the bestiary offers exact Goal and brain prompt previews", () => {
  const html = renderPromptBestiary({
    goals: [{ file: "otto/test/goal-probe.md", title: "Probe", area: "otto/test" }],
    brains: [{ area: "otto/test", generation: 2 }],
    inspector: { title: "Current prompt", text: "# Exact prompt\n\nDo the thing.", loading: false, error: "" },
  });
  assert.match(html, /data-load-goal-prompt/);
  assert.match(html, /data-load-brain-prompt/);
  assert.match(html, /goal-probe\.md/);
  assert.match(html, /# Exact prompt/);
  assert.match(html, /One brain \+ agent sequence/);
});
