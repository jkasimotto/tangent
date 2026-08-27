import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_LIFECYCLES, LIFECYCLES, MODEL_CONCEPTS, PROMPT_SPECIES, renderPromptBestiary } from "./public/prompt-bestiary.js";

test("the bestiary covers prompts, routing events, and common agent lifecycles", () => {
  assert.deepEqual(PROMPT_SPECIES.map((item) => item.id), ["brain", "goal", "pipeline", "brain-notice", "brain-request", "handover", "context", "comment"]);
  assert.deepEqual(LIFECYCLES.map((item) => item.id), ["plan", "brain-solo", "brain-pipeline", "decision", "test", "context", "document", "brain-stop"]);
  assert.deepEqual(LEGACY_LIFECYCLES, []);
  assert.ok(LIFECYCLES.every((item) => item.transitions.length >= 3));
});

test("the Model view separates exact-Area identity from command permission", () => {
  const brain = MODEL_CONCEPTS.find((item) => item.id === "brain");
  assert.match(brain.definition, /one exact Area/);
  assert.match(brain.definition, /does not grant command permission/);
  assert.match(brain.lifecycle, /active or inactive/);
  assert.match(brain.lifecycle, /health remain diagnostic/);
});

test("the bestiary leads with a selectable lifecycle and an exact server-built message", () => {
  const html = renderPromptBestiary({
    goals: [{ file: "otto/test/goal-probe.md", title: "Probe", area: "otto/test" }],
    brains: [{ area: "otto/test", generation: 2 }],
    selection: { mode: "messages", lifecycle: "brain-pipeline", transition: "handover" },
    inspector: { title: "Current prompt", text: "# Exact prompt\n\nDo the thing.", loading: false, error: "" },
  });
  assert.match(html, /Understand the objects, owners, and transitions\./);
  assert.match(html, /data-bestiary-lifecycle="brain-pipeline" aria-pressed="true"/);
  assert.match(html, /data-bestiary-transition="handover" aria-pressed="true"/);
  assert.match(html, /Only the brain classifies the report/);
  assert.match(html, /Exact messages agents receive/);
  assert.match(html, /same server function used when it launches the agent/);
  assert.match(html, /data-load-goal-prompt/);
  assert.match(html, /data-load-brain-prompt/);
  assert.match(html, /goal-probe\.md/);
  assert.match(html, /# Exact prompt/);
  assert.doesNotMatch(html, /Legacy encounters/);
});

test("the brain boundary never invents prompt text without a live brain", () => {
  const html = renderPromptBestiary({ selection: { mode: "messages", lifecycle: "plan", transition: "work" } });
  assert.match(html, /Choose a Brain/);
  assert.match(html, /Show brain prompt/);
  assert.doesNotMatch(html, /# Brain for &lt;area&gt;/);
  assert.doesNotMatch(html, /Request one plan approval/);
});

test("a live Goal states whether a brain controls it", () => {
  const managed = renderPromptBestiary({
    goals: [{ file: "otto/dnd/goal-move.md", title: "Move", area: "otto/dnd/movement" }],
    brains: [{ area: "otto/dnd/movement", generation: 3, status: "active" }],
    selection: { mode: "messages" },
    inspector: { file: "otto/dnd/goal-move.md" },
  });
  assert.match(managed, /Managed work/);
  assert.match(managed, /Organized by brain otto\/dnd\/movement/);

  const parentOnly = renderPromptBestiary({
    goals: [{ file: "otto/dnd/goal-move.md", title: "Move", area: "otto/dnd/movement" }],
    brains: [{ area: "otto/dnd", generation: 3, status: "active" }],
    selection: { mode: "messages" },
    inspector: { file: "otto/dnd/goal-move.md" },
  });
  assert.match(parentOnly, /No Area brain record/, "a parent brain is not the child Area's logical organizer");

  const unmanaged = renderPromptBestiary({
    goals: [{ file: "otto/old/goal-one.md", title: "Old", area: "otto/old" }],
    selection: { mode: "messages" },
    inspector: { file: "otto/old/goal-one.md" },
  });
  assert.match(unmanaged, /No Area brain record/);
  assert.match(unmanaged, /Direct commands remain available/);
  assert.match(unmanaged, /logical Area inbox/);
});

test("the model starts with stable concepts and separates Subgoal and Ask semantics", () => {
  assert.deepEqual(MODEL_CONCEPTS.map((item) => item.id), ["area", "goal", "subgoal", "document", "program", "brain", "pipeline", "run", "request", "test", "ask", "view"]);
  const html = renderPromptBestiary({
    goals: [{ title: "Parent", area: "otto/test", depth: 0 }, { title: "Child", area: "otto/test", depth: 1 }],
    selection: { mode: "model", concept: "subgoal" },
  });
  assert.match(html, /data-model-mode="model" aria-pressed="true"/);
  assert.match(html, /data-model-concept="subgoal" aria-pressed="true"/);
  assert.match(html, /A Goal that contributes to another Goal/);
  assert.match(html, /1 Subgoal/);
  assert.match(html, /An Ask is a projection from a Request or runtime fact/);
});

test("the stopped Brain lifecycle separates runtime and durable state", () => {
  const html = renderPromptBestiary({ selection: { mode: "lifecycles", lifecycle: "brain-stop", transition: "retainBrain" } });
  assert.match(html, /A Brain session stops/);
  assert.match(html, /Retain Brain records/);
  assert.match(html, /No request is answered and no inbox notice is removed/);
  assert.doesNotMatch(html, /Inspect a live instance/);
});
