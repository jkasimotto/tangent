import type { RollupPeriod } from "../types/period.js";
import type { RollupPurpose } from "../types/digest.js";
import { rollupJsonSchema } from "./schemas.js";

export function rollupPrompt(args: {
  inputPath?: string;
  period: RollupPeriod;
  inputJson?: string;
  purpose?: RollupPurpose;
}): string {
  const inputInstruction = args.inputJson
    ? `Use this JSON input:\n${args.inputJson}`
    : `Read the JSON input file at:\n${args.inputPath}`;

  const purposeInstruction = args.purpose
    ? `

Purposeful roll-up request:
${JSON.stringify(args.purpose, null, 2)}

Use this request to decide what is relevant. The date range defines the source material; the purpose defines the synthesis goal.`
    : `

Default roll-up request:
Create a private engineering memory note for the selected period.`;

  const focusTerms = args.purpose?.focusTerms && args.purpose.focusTerms.length > 0
    ? `Include: ${args.purpose.focusTerms.map((focus) => `\"${focus}\"`).join(", ")}.`
    : "No specific focus terms were provided.";

  return `You are generating the private engineering roll-up from coding-agent conversations for ${args.period.label}.

${inputInstruction}
${purposeInstruction}

Reader:
The reader is a software engineer returning to this work days, weeks, or months later. The note should preserve engineering memory for design, debugging, implementation choices, and future decisions.

Primary job:
Turn the conversations into durable engineering memory. Preserve the user's mental model, terminology, constraints, assumptions, decisions, tradeoffs, experiments, findings, unresolved questions, and reusable prose for later design docs, PRs, issues, prompts, or implementation plans.

Relevance:
Include material when it would still matter later:
- a design decision and the rationale behind it
- a tradeoff, constraint, assumption, or rejected alternative
- an investigation path and what it proved
- a reusable explanation that can be copied into future docs
- a validation command, test, file path, schema, API, function, or data model that is an anchor for follow-up
- an open question or risk that remains relevant

When a purpose is present:
- Organize around the requested purpose, not calendar chronology.
- Prefer sections that can become a design or investigation brief.
- Use focusTerms as recall anchors, including related terms present in conversation.

Writing style:
- Prefer connected, concise engineering prose.
- Use headings named for systems, decisions, investigations, or design areas.
- Prefer synthesis over chronology. Merge repeated turns into the underlying idea.
- Use bullet lists for compact commands, test checklists, implementation anchors, tradeoff lists, or follow-ups.
- Keep direct quotes short and only when wording is exact and useful.
- Represent uncertainty explicitly when source material is truncated or ambiguous.
- markdown must be the full generated note body for the rollup generated block.
- Output valid JSON matching the schema.
- ${focusTerms}

Examples:

Conversation snippet:
User: The key point is that surface attachment should be a normal routing target, not just a fallback after same-Z movement fails. Otherwise click routing and climb behavior drift apart.
Assistant: I can update the pathfinder to consider climb attachment earlier and add route-contact tests.
User: Yes, and the tests should assert public routing behavior, not mock internals.
Assistant: Done. I also committed it.
User: Please rerun the targeted tests.

Desired output:
### Surface-aware routing

The durable design point was that surface attachment belongs in the normal set of routing targets rather than as a fallback after same-Z movement fails. Making it a first-class target keeps click routing and climb behavior aligned with authored surface topology instead of collapsing route generation into tile-level assumptions.

Validation mattered most through public route-contact and climb/ramp behavior tests, because those assertions protect behavior visible to users and authored surfaces.

Conversation snippet:
User: The simulation sometimes advances one extra tick after pause. I suspect the event queue is being drained after the pause flag is set.
Assistant: I found that processFrame calls flushScheduledEvents before checking sim.paused.
User: That explains the symptom. The pause boundary should be before event draining, but we still need deterministic replay to flush events that were already admitted.
Assistant: We can split admitted events from pending events.
User: Capture that. The invariant is "pause stops admission, not completion."

Desired output:
### Simulation pause boundary

The useful invariant from that investigation was: pause stops event admission, not event completion. The issue came from admitted work continuing to drain after pause changed, which can produce extra-frame completion.

The intended fix is to separate already-admitted events from pending events, then preserve replay determinism while enforcing a strict admission boundary at pause.

Implementation anchors:
- processFrame and event queue draining order
- pause boundary checks before scheduling/admitting new work
- deterministic replay behavior for already-admitted work

Conversation snippet:
User: For the eval UI, I want total tokens, total time, active agent time, number of tool calls, and actual result comparison side by side.
Assistant: I can design that.
User: Hooks are deprecated and can be deleted.
Assistant: I’ll write the cleanup note.
User: Please commit when done.
Assistant: Committed.
User: Actually rollup topic is probably dead code too. Rollup should be "read my messages of the day and carry forward useful things."

Desired output:
### Eval and rollup direction

The eval UI should prioritize result comparison plus quality signals: total tokens, wall-clock duration, active agent time, and tool-call count. This supports deciding between candidates by outcome quality rather than tool verbosity alone.

Rollup should stay topic-light. The useful direction is a purpose-oriented memory extractor that carries forward meaningful engineering context from conversations; hook-based capture and topic-centric abstractions should not be reintroduced as central primitives.

Conversation snippet:
Purposeful request:
Create a design brief on data-driven simulations from the last four weeks. Focus on "data-driven simulation", "timeline", "event queue", "deterministic replay", and "authoring schema".

User: The authoring schema should describe events and constraints, not imperative behavior.
Assistant: So systems consume data and produce simulation transitions?
User: Exactly. I want designers to author rules, not scripts.
...
User: The timeline model only works if replay is deterministic.
Assistant: The event queue currently stores wall-clock timestamps.
User: That is the wrong layer. It should store simulation ticks or logical time.
...
User: Separate thing: fix the README typo and commit.
Assistant: Done.

Desired output:
## Data-driven simulation design model

The emerging model is data-driven simulation: behavior comes from authored events, constraints, and rules, while runtime systems interpret those inputs to produce state transitions. This shifts intent toward expressive authoring data, not imperative scripts.

Deterministic replay depends on logical simulation time. The event queue needs simulation ticks (or another deterministic ordering signal), not wall-clock timestamps.

### Design constraints

- Authoring schema should describe events, constraints, and rules.
- Runtime systems interpret authored data and produce transitions.
- Replay should use logical time to preserve event ordering across runs.
- The event queue should support deterministic reconstruction of admitted work.

Open questions:
- How much expressiveness belongs in the schema before it becomes a scripting language?
- What is the minimal event representation for deterministic replay and robust debugging?

Conversation snippet:
User: Implement the parser refactor described in the issue.
Assistant: I changed parseConfig and updated tests.
User: Run the suite.
Assistant: Tests pass.
User: Commit.

Desired output:
### Parser refactor

This conversation was mostly implementation delegation, with limited reusable reasoning. The durable memory item is that the parser refactor was completed and validated by test execution.

For deeper details, follow the issue or code diff later. A future rollup should include references only if later investigation adds rationale or design tradeoffs.

JSON schema:
${JSON.stringify(rollupJsonSchema)}
`;
}
