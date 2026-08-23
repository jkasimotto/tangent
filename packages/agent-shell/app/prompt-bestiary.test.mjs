import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_LIFECYCLES, LIFECYCLES, PROMPT_SPECIES, renderPromptBestiary } from "./public/prompt-bestiary.js";

test("the bestiary covers prompts, routing events, and common agent lifecycles", () => {
  assert.deepEqual(PROMPT_SPECIES.map((item) => item.id), ["brain", "goal", "pipeline", "brain-notice", "brain-request", "handover", "context", "comment"]);
  assert.deepEqual(LIFECYCLES.map((item) => item.id), ["plan", "brain-solo", "brain-pipeline", "decision", "test", "context", "document"]);
  assert.deepEqual(LEGACY_LIFECYCLES.map((item) => item.id), ["legacy-solo", "legacy-pipeline"]);
  assert.ok(LIFECYCLES.every((item) => item.transitions.length >= 3));
});

test("the bestiary leads with a selectable canonical lifecycle", () => {
  const html = renderPromptBestiary({
    goals: [{ file: "otto/test/goal-probe.md", title: "Probe", area: "otto/test" }],
    brains: [{ area: "otto/test", generation: 2 }],
    selection: { lifecycle: "brain-pipeline", transition: "handover" },
    inspector: { title: "Current prompt", text: "# Exact prompt\n\nDo the thing.", loading: false, error: "" },
  });
  assert.match(html, /Follow the work\. Inspect every boundary\./);
  assert.match(html, /data-bestiary-lifecycle="brain-pipeline" aria-pressed="true"/);
  assert.match(html, /data-bestiary-transition="handover" aria-pressed="true"/);
  assert.match(html, /Only the brain classifies the report/);
  assert.match(html, /Message sent/);
  assert.match(html, /tangent handover/);
  assert.match(html, /&lt;paths&gt;/);
  assert.match(html, /data-load-goal-prompt/);
  assert.match(html, /data-load-brain-prompt/);
  assert.match(html, /goal-probe\.md/);
  assert.match(html, /# Exact prompt/);
  assert.match(html, /Legacy encounters/);
});

test("the canonical brain boundary shows its prompt without live data", () => {
  const html = renderPromptBestiary({ selection: { lifecycle: "plan", transition: "work" } });
  assert.match(html, /# Brain for &lt;area&gt;/);
  assert.match(html, /Julian's instruction/);
  assert.match(html, /&lt;durable-worker-and-user-notices&gt;/);
});

test("a live Goal states whether a brain controls it", () => {
  const managed = renderPromptBestiary({
    goals: [{ file: "otto/dnd/goal-move.md", title: "Move", area: "otto/dnd/movement" }],
    brains: [{ area: "otto/dnd", generation: 3, status: "running" }],
    inspector: { file: "otto/dnd/goal-move.md" },
  });
  assert.match(managed, /Managed work/);
  assert.match(managed, /Controlled by brain otto\/dnd/);

  const legacy = renderPromptBestiary({
    goals: [{ file: "otto/old/goal-one.md", title: "Old", area: "otto/old" }],
    inspector: { file: "otto/old/goal-one.md" },
  });
  assert.match(legacy, /Legacy direct Goal/);
  assert.match(legacy, /old direct-to-Julian rules/);
});
