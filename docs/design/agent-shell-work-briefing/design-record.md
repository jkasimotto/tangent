# Agent Shell Work Briefing: reorientation before reprioritization

Date: 2026-08-28

Status: proposed product vision. This record does not include implementation work.

Lens applied: UI/UX.

Architecture, storage, and model ownership remain outside this product-vision decision. A later design must preserve the product contract in this record.

## 1. Decision summary

Add an on-demand **Work Briefing** to Agent Shell. Its visible entry action is **Orient me**.

The briefing gives Julian a guided story before it asks him to choose work. It reconstructs intent, change, causality, time, and responsibility.

The briefing starts with the bottom line. It then shows evidence and alternative readings on demand.

The briefing ends with a short working plan that Julian accepts or changes. Agent Shell then returns him to Work at the first chosen item.

The briefing does not rank work from activity, age, or Goal count alone. It states missing facts instead of inventing importance, dates, or responsibility.

Work remains the fast execution surface. The briefing is a separate reorientation surface for moments when the project model is missing from Julian's mind.

## 2. Problem contract

Julian described the root need directly: “I need to be told a story to reprioritize.”

Work is effective after Julian knows his intended work. Work is ineffective when he must first reconstruct the project situation.

The blocked outcome is not task retrieval. The blocked outcome is a sound priority decision under reduced attention and working-memory capacity.

That decision requires answers to six questions:

1. What are the main Areas now?
2. Why does each Area matter?
3. What changed, and what caused the current state?
4. What must happen by which date or event?
5. Who has the next move?
6. What can wait, return, or move as one batch?

The current screen provides pieces of these answers. Julian must assemble the pieces while he has the least capacity to do so.

### 2.1 Constraints

- The default path must work for a tired reader.
- The briefing must provide value before it asks a question.
- The briefing must show information in a deliberate sequence.
- Every priority suggestion must include a reason.
- Every reason must lead to recorded evidence.
- Missing or stale evidence must remain visible.
- The user must accept all changes to work state or the working plan.
- The briefing must remain quiet until Julian opens it.
- The briefing must preserve the fast path from Work into an agent or brain.
- The briefing scope must always be visible.

### 2.2 Non-goals

- A denser Work table.
- A universal numeric priority score.
- Automatic reprioritization.
- Automatic detection of fatigue or illness.
- A replacement for an Area brain.
- A project-management calendar.
- A mandatory daily or weekly review.
- A new ontology for Areas, Goals, Documents, or agents.
- A decision about the technical narrator or storage format.

### 2.3 Observable success

The design succeeds when Julian can reconstruct the project without opening many Goal rows.

After the short version, Julian can name the main Areas, pressure points, and missing facts. He can explain why each item appeared.

After the complete briefing, Julian can identify the next actor and time horizon for chosen work. He can also identify one useful batch.

The briefing can surface an old Goal without calling age “value.” It must explain the current reason for reconsideration.

The final working plan states what happens, when or after which event, and who acts. Julian can change it before acceptance.

## 3. Current system

All statements in this section are Observed unless another label appears.

### 3.1 Work is an execution index

The screenshot shows 31 open Goals, two blockers, one due process, and no `Current` text for Neara.

The dominant structure is Area, Goal, state, elapsed time, and action. This structure answers where Julian can act.

Area headers summarize open, moving, blocked, and question counts. They also expose a brain route and the Area-note age signal.

The summary code explicitly omits waits and handovers from the count. This rule protects Julian from agent-volume noise.

Work therefore solves a different problem well. It supports selection and execution after the user has a priority model.

### 3.2 The source material for a story already exists

Each Goal can carry a result, state, current brief, story, waiting party, due value, session, Subgoals, and dependencies.

Each Area can carry a purpose, `Current` text, people, Documents, Goals, and note-age signal.

The Goal reader reduces one Goal to its requested result and five recent story moments. This memory is local to one Goal.

The Area note signal reports missing or old `Current` text. Work shows the signal, but it does not show the Area story.

The existing “What happened” view shows Goal closures from the last 12 hours. It does not connect those events to future choices.

The system also knows recent changes, dependencies, agent history, open questions, processes, and current brain state.

### 3.3 The current Neara snapshot exposes the synthesis burden

The `tangent goal list neara --subtree --status open --json` result contained 31 Goals across 11 Areas on 2026-08-28.

PG&E contained 21 Goals. Hackathon contained eight. Essential and Portland contained one each.

Eight Viz Input Goals last changed on 2026-08-09. Four approval Goals identify Tom, Eric, Toby, Sami, or Sahan in titles or results.

Two Hackathon Goals have the same title, “Deployed instance for hackathon.” The list does not explain whether both remain valid.

Three leaf Goals explicitly unlock later Goals. Two leaves belong to benchmarking, and one belongs to autodesign.

The screenshot also shows a due PG&E speedrun process whose brain is not running.

These facts support several plausible stories. They do not establish which story matters most to Julian today.

### 3.4 Root diagnosis

The information is distributed by storage object and execution state. Julian needs it organized by decision.

Counts provide perception without comprehension. Recent activity provides movement without purpose. Dependencies provide causality without value.

A Goal story restores one local context. It does not restore the relationship between Areas, commitments, people, and time horizons.

The screen also lacks a comparison point. It cannot say what changed since Julian last formed a complete project model.

The missing product function is a structured self-handoff. The system must hand the project back to Julian before he takes control again.

## 4. Research findings and transfer limits

The research supports design principles, not a formula for priority. Most studies did not examine software project work.

### 4.1 Reduced capacity changes the interface requirement

Lim and Dinges found broad cognitive effects from short-term total sleep deprivation. Attention lapses showed the largest reported effect in their meta-analysis.

This evidence does not represent ordinary tiredness or sickness exactly. It still supports a low-capacity design target.

**Product consequence:** The briefing must reduce search, recall, comparison, and self-directed sequencing. It cannot require those abilities before it helps.

### 4.2 Interrupted goals need retrieval cues

Altmann and Trafton measured a resumption lag after interruptions. External cues near the interrupted task reduced that lag in their experiment.

Their earlier memory-for-goals model also emphasizes goal activation and associative cues. A title alone is a weak cue for a complex project state.

**Product consequence:** Each Area story needs intent, last meaningful change, and next move. The briefing must restore the thread, not only name it.

### 4.3 Situation awareness has three layers

Endsley models situation awareness as perception, comprehension, and projection. Attention and working memory constrain all three layers.

The current Work table strongly supports perception. It shows objects and states. Julian still performs comprehension and projection himself.

**Product consequence:** The briefing sequence must move from facts, to meaning, to likely next states. Action selection comes after those layers.

### 4.4 Stories build situation models

Zwaan and Radvansky describe situation models across time, space, causation, intention, and protagonist.

These dimensions transfer cleanly to project work. Area supplies place, Goal supplies intention, dependencies supply cause, and people supply protagonists.

**Product consequence:** A useful project story must connect these dimensions. A chronological activity feed is not sufficient.

### 4.5 External representations reduce memory demand

Risko and Gilbert define cognitive offloading as changing the environment to reduce information-processing demand.

Masicampo and Baumeister found that specific plans reduced interference from unfinished goals. Their effective plans named how, when, and where action occurred.

**Product consequence:** The briefing must end with an external working plan. A summary without a plan leaves the next decision inside Julian's memory.

### 4.6 Near and distant work need different detail

Construal-level research links near events to concrete representation. Distant events use more abstract representation.

**Product consequence:** Near work needs an exact action, actor, and date or event. Later work needs purpose and a return condition.

### 4.7 Cues and batches reduce switching work

Rubinstein, Meyer, and Evans found task-switching costs that grew with rule complexity. Explicit task cues reduced those costs.

This research does not prove that every batch improves project work. It supports grouping work that shares an actor, tool, or decision mode.

**Product consequence:** The briefing can propose batches, but urgency and causal order outrank batching convenience.

### 4.8 Guided narrative and exploration need balance

Segel and Heer describe interactive slideshows and a guided-then-exploratory structure. Their study examined 58 narrative visualizations.

Shneiderman's information-seeking sequence starts with an overview. It then supports filtering and details on demand.

**Product consequence:** The briefing needs a guided opening and constrained drill-down. A dashboard offers exploration before orientation.

### 4.9 Narrative framing is a product risk

Hullman and Diakopoulos show that narrative presentation can prioritize an interpretation. Omission and visual emphasis can change the reader's conclusion.

Fuzzy-trace research also distinguishes bottom-line meaning from exact detail. The reviewed evidence comes mainly from health decisions.

**Product consequence:** Show gist and exact evidence together. Also show uncertainty, omitted work, and credible alternative readings.

### 4.10 A briefing is a useful handoff analogy

The I-PASS handoff program uses a standard structure for situation, action, contingency, and receiver synthesis.

A multicenter study associated the complete program with fewer medical errors. That result does not prove benefits for a personal project briefing.

**Product consequence:** Use one stable story grammar. End with Julian's synthesis and acceptance, not the narrator's final word.

## 5. Candidate designs

| Candidate | Strength | Decisive problem |
|---|---|---|
| Add priority, owner, and date columns to Work | Keeps one surface and supports fast scanning | Julian still performs synthesis across rows |
| Ask a brain for a summary | Supports dialogue and follow-up questions | Julian must choose scope, form a prompt, and validate an unstructured answer |
| Make the Area map or timeline primary | Shows history, structure, or dependencies well | No single view explains intention, trade-offs, responsibility, and time |
| Send a scheduled digest | Can prepare context before the user opens Work | It interrupts, becomes stale, and arrives without knowing the decision moment |
| Add an on-demand Work Briefing | Rebuilds context in sequence and ends in action | Adds one product surface and a narrative-authority risk |

### 5.1 Decision

Select the on-demand Work Briefing.

The briefing creates the missing transition between “I arrived” and “I know what to do.” Work keeps the transition from choice to execution.

The strongest alternative is a conversation with a brain. It loses because the blank user must still initiate and structure the reconstruction.

The briefing can open a conversation after the guided story. Conversation is a drill-down tool, not the first cognitive requirement.

## 6. Product vision

### 6.1 Entry and scope

Work has one visible **Orient me** action. The briefing never opens because of a timer, stale note, process event, or agent event.

The default scope is the current Work scope. The first line always names that scope and the evidence time.

Julian can widen or narrow the scope without losing his place. The briefing never hides a scope choice inside the generated text.

An expert can skip directly to Work, the complete outline, or the evidence. The guided path remains the default.

### 6.2 The briefing sequence

The briefing uses five chapters. Each chapter presents one dominant idea within one viewport.

```text
Recorded work
     |
     v
1. The short version       What matters in this scope?
     |
     v
2. How we got here         What changed since the last orientation?
     |
     v
3. Where pressure sits     What has a date, dependency, risk, or next actor?
     |
     v
4. What can move together  What can batch, wait, or return now?
     |
     v
5. A proposed next chapter What working plan makes sense, and why?
     |
     v
Julian accepts or changes the plan -> Work opens at the first chosen item
```

The sequence follows situation awareness. It also follows a narrative from setting, through change and tension, into possible action.

### 6.3 Chapter one: The short version

The first chapter contains three to five short statements. Each statement connects an Area to a consequence or an unknown.

The chapter answers the six problem questions at gist level. It does not list every open Goal.

The footer states how much work the story omitted. **All open work** remains one action away.

### 6.4 Chapter two: How we got here

This chapter starts from the last completed briefing. On the first use, it starts from the latest reliable Area stories and meaningful changes.

It shows only events that changed intention, state, ownership, dependency, or time. Raw agent activity does not qualify by itself.

Finished work appears when it changes the present story. A list of closures remains available as evidence.

### 6.5 Chapter three: Where pressure sits

This chapter groups pressure by time horizon and next actor. It does not group pressure by generic status.

The time horizon has four forms:

- An exact date.
- An event condition, such as “after Dan's branch is available.”
- A user-accepted horizon, such as now, this week, or later.
- Unknown.

The next actor names the person or system with the next move. It does not repeat a broad owner when that owner cannot act now.

Valid actor labels include Julian, a named person, an Area brain, an agent, an external dependency, and unknown.

The chapter also shows likely consequences from explicit dates and dependencies. It labels all other forecasts as interpretations.

### 6.6 Chapter four: What can move together

This chapter proposes small batches that reduce context changes. It never merges the underlying Goals.

A batch can share one of four contexts:

- The same person or communication.
- The same repository, branch, or tool.
- The same mode, such as reading, validation, or decision.
- The same dependency chain.

An urgent action leaves a batch when waiting creates risk. The briefing explains that exception.

This chapter also surfaces forgotten work. Age alone never makes an old Goal valuable.

An old Goal earns reconsideration when current evidence gives it a reason. Examples include a newly available dependency or a renewed Area outcome.

Each resurfaced Goal states why it returned now. Julian can keep it, defer it to a date or event, or remove it from the working plan.

### 6.7 Chapter five: A proposed next chapter

The final chapter proposes a short, ordered working plan. It uses no universal score.

The proposal compares six factors in plain language:

1. Julian's stated outcomes and current commitments.
2. Exact dates and event conditions.
3. Actions that only Julian can take.
4. Work that unlocks other work.
5. Useful batches.
6. Old work with a current reason to return.

Every ordering statement uses this form: do this before that, because this recorded constraint changes the outcome.

If the system lacks importance or timing, it asks one focused question after it gives the useful context.

The working plan gives each item an action, next actor, and date or event. A later item can use an abstract return condition.

Julian can accept, reorder, edit, or decline the plan. No Goal, Area, date, actor, or focus changes before acceptance.

### 6.8 Return to Work

After acceptance, Work opens at the first plan item. A compact **Working plan** line keeps the accepted sequence visible.

The plan line is not another dashboard. It shows the current item, the next item, and the next return condition.

The normal Area structure remains below it. Work outside the plan remains reachable and visibly outside the current focus.

The plan persists across sessions because forgetting across sessions is part of the problem. A later design decides its storage.

When recorded facts change, the line marks the affected plan item. It does not silently reorder the plan.

## 7. Story and evidence contract

### 7.1 Stable story grammar

Each Area story uses the same fields:

| Field | Question |
|---|---|
| Intent | What result matters here? |
| Position | Where is the Area now? |
| Change | What changed since the last orientation? |
| Cause | What enabled, blocked, or changed this position? |
| Next actor | Who can move it now? |
| Time horizon | By which date or after which event? |
| Outlook | What changes if this moves or does not move? |

This grammar maps project facts to the dimensions of a situation model. It prevents a story from becoming polished activity prose.

### 7.2 Three claim types

The briefing distinguishes three claim types:

- **Recorded:** A source states the fact directly.
- **Inferred:** The system connects recorded facts and names the inference.
- **Suggested:** The system proposes a priority, batch, or plan.

The default prose remains clean. A visible evidence action exposes the claim type, source, source time, and exact supporting fact.

A stale `Current` section remains stale in the briefing. A recent agent event cannot silently make the Area story current.

A conflict between sources appears as a conflict. The briefing can propose a clarification action, but it cannot choose a convenient source.

### 7.3 Narrative framing controls

The briefing always provides these controls:

- **Why this is here** shows evidence and the selection reason.
- **Another reading** shows a credible alternative when the interpretation changes priority.
- **All open work** shows the complete inventory for the scope.
- **Not enough information** lists missing purpose, date, actor, or dependency facts.

The story never presents omission as completion. The short version states the omitted Goal and Area counts.

### 7.4 Corrections

Julian can correct a fact from its evidence view. The briefing sends the proposed correction through the owning brain or existing edit path.

The correction remains a proposal until Julian accepts its exact effect. The current briefing marks affected statements as changed.

## 8. Example from the observed snapshot

This example shows the product form. It does not claim to know Julian's actual priority.

```text
NEARA WORK BRIEFING                                snapshot 2026-08-28
The short version                                             1 of 5

PG&E contains 21 of 31 open Goals, but Neara has no recorded Current story.

Viz Input contains eight Goals last changed on August 9. If landing still
matters, four reviewer actions form one communication batch.

Benchmarking has two startable leaves that unlock its benchmark. Autodesign
has one startable leaf that unlocks element-level suppression.

Hackathon contains two Goals named “Deployed instance for hackathon.” Their
relationship is unknown, so the Area needs clarification before more deployment work.

The speedrun process is due, but its brain is not running. Its business deadline
is not recorded here.

Missing for a responsible priority: the current Neara outcome and the nearest
external date.

[Why this story]  [All 31 Goals]                    [Continue ->]
```

This briefing already reduces reconstruction work. It also refuses the final rank because the value and date evidence is incomplete.

One focused question can follow: “Which commitment has the nearest external date?” The answer changes the proposed working plan.

## 9. Complete UI workflow

1. Julian opens Work and selects **Orient me**.
2. Agent Shell shows the current scope and evidence time.
3. The short version appears without a setup question.
4. Julian reads forward or opens evidence for one surprising statement.
5. The briefing shows changes, pressure, next actors, batches, and return candidates.
6. The briefing proposes a working plan with reasons.
7. Julian changes one item and accepts the plan.
8. Work returns with the first plan item selected.
9. The compact working-plan line preserves the next move across later context changes.

Escape returns to the prior Work position. Reopening the briefing restores its chapter and scroll position until the evidence changes.

## 10. UI/UX lens analysis

### 10.1 Intent and common path

The primary intent is reorientation before action. The common path is Work, briefing, accepted plan, then Work at the selected Goal.

The secondary intent is explanation. Julian opens evidence, an alternative reading, an Area, a Goal, or a brain without losing briefing position.

### 10.2 Context, navigation, and editing

The briefing keeps the Work scope, prior cursor, folds, and return point. It never replaces the terminal or an active agent.

Chapter navigation uses visible Back and Continue actions. Keyboard commands use the existing ownership and shortcut-display contracts.

The exact shortcut remains a later navigation decision. The entry action must show its shortcut when one exists.

Editing occurs only in the final plan or an explicit fact-correction flow. All edits show their consequence before acceptance.

### 10.3 State that remains visible

The header shows scope, evidence time, chapter position, and freshness. Each suggestion shows its reason.

The final plan shows action, next actor, and time horizon. Unknown values use the word `Unknown`.

The Work return keeps the accepted plan visible without hiding the complete Work structure.

### 10.4 Loading, partial, stale, and conflict states

**Loading:** The frame, scope, and chapter titles remain stable. The body uses one calm loading state.

**No prior briefing:** Chapter two uses reliable recorded history. It labels the missing comparison point.

**Partial runtime data:** The story uses vault facts and labels live agent state unavailable. It does not convert unavailable into idle.

**Missing `Current`:** The short version states the missing Area story. It uses lower-level facts without pretending that they express current importance.

**Stale source:** The statement shows the source date. A stale source cannot support an unmarked current-state claim.

**Conflict:** Both facts remain visible. Plan acceptance pauses only for the affected item.

**Facts change during reading:** The header shows that the story changed. Julian can refresh or keep reading the timestamped snapshot.

**Empty scope:** The briefing says that no Goals are open. It can still show due processes, recent closures, and the accepted working plan.

**Large scope:** The first chapter stays bounded. Complete inventory and Area drill-down remain available.

**Interrupted briefing:** Reentry restores the chapter and evidence drawer. No unaccepted plan edit survives as a work-state change.

### 10.5 Feedback and consequence

Chapter navigation is instant and reversible. It needs no confirmation.

Accepting a working plan has a visible scope and an Undo action. Any source edit uses its existing consequence and acceptance contract.

Starting an agent remains a separate action in Work. Orientation never starts work by itself.

### 10.6 Accessibility and expert efficiency

Each chapter has one heading and a logical reading order. Claim types and freshness never depend on color alone.

The interface supports keyboard navigation, screen readers, zoom, reduced motion, and visible focus. No timed advance exists.

An expert can open the complete outline, jump to any chapter, or return to Work. Progressive disclosure never traps the user in a tutorial.

### 10.7 Product-wide cognitive cost

The design adds one entry action, one temporary surface, and one compact working-plan line. It does not add fields to every Work row.

The new surface earns its cost because it serves a distinct mental state. It also leaves the existing high-speed path unchanged.

## 11. Pressure tests and counterexamples

### 11.1 Recency is not priority

The API-key Goal changed most recently in the observed snapshot. The Viz Input approvals are much older.

A recency rank favors the API key. It cannot know whether the megabranch has the more important external commitment.

**Decision:** Recency can explain change and staleness. It cannot establish value.

### 11.2 Dependency leaves are not the whole story

The snapshot contains three explicit leaves that unlock other Goals. The Viz Input approval chain appears mainly in titles and result text.

A dependency-only story misses important causal relationships when the graph is incomplete.

**Decision:** Explicit dependencies support recorded claims. Text can support labeled inferences, but not silent graph facts.

### 11.3 Age does not make forgotten work valuable

Old Viz Input and Hackathon Goals can represent neglected value, obsolete intent, duplicate records, or completed work with stale state.

**Decision:** Resurface old work only with a current reason. Otherwise, place it under missing information or complete inventory.

### 11.4 A polished story can hide a wrong frame

A narrator can describe PG&E as the main story because it has 21 Goals. Count does not establish importance.

**Decision:** The story must expose selection reasons, omitted work, alternatives, and missing priority evidence.

### 11.5 More progressive steps can become more work

Five mandatory screens can burden a user who only needs one reminder sentence.

**Decision:** The first chapter must stand alone. Every later chapter is skippable, and the complete outline is directly available.

### 11.6 Batching can delay an urgent item

Four reviewer actions look batchable. One approval can still have an earlier deadline or a separate causal path.

**Decision:** Exact urgency and causal order split a batch. Convenience never outranks recorded risk.

### 11.7 A persistent plan can become another stale source

A working plan can outlive its assumptions. Silent persistence then recreates the original problem.

**Decision:** The plan preserves its accepted reasons and source times. Changed assumptions mark the item for reorientation.

## 12. Detailed decisions

1. **Add a separate Work Briefing.** Do not turn Work into a narrative dashboard.
2. **Use the label `Orient me`.** The user intent is mental reorientation, not report generation.
3. **Keep the briefing on demand.** Do not open it from schedules, inactivity, stale notes, or agent events.
4. **Default to a guided five-chapter sequence.** Keep every chapter skippable.
5. **Make the first chapter independently useful.** It contains the bottom line and missing priority facts.
6. **Use one story grammar.** Intent, position, change, cause, next actor, time horizon, and outlook form each Area story.
7. **Separate recorded, inferred, and suggested claims.** Every claim has evidence and a source time.
8. **Expose omitted work and alternative readings.** Narrative clarity cannot hide the frame.
9. **Represent responsibility as the next actor.** A broad owner remains secondary context.
10. **Represent time with dates, event conditions, accepted horizons, or unknown.** Do not invent a due date.
11. **Offer batches by shared context.** Urgency and causal order can split them.
12. **Resurface old work only with a current reason.** Age alone is not a value signal.
13. **Use explicit reasons instead of a score.** A suggestion compares commitment, time, agency, leverage, batch value, and renewed relevance.
14. **End with a user-accepted working plan.** Each item states action, next actor, and date or event.
15. **Persist the working plan across sessions.** A later design decides its technical representation.
16. **Return to Work at the first plan item.** Keep a compact plan line visible until revision or completion.
17. **Do not start work during orientation.** Starting remains an explicit Work action.

## 13. Rejected alternatives

### 13.1 More columns and smarter sorting

This alternative is the cheapest visual change. It also preserves the exact synthesis burden that blocks Julian.

Columns can support the evidence view later. They cannot replace the briefing.

### 13.2 Free conversation as the primary path

Conversation is the strongest alternative because it can adapt to Julian's questions. It also requires a question before orientation begins.

The answer length, coverage, and evidence can vary by agent. Use conversation after the guided opening.

### 13.3 A timeline-first product

A timeline answers when events occurred. It does not explain why an Area matters, who acts next, or which future condition changes priority.

Use time as one briefing dimension, not the organizing product model.

### 13.4 A dependency graph-first product

A graph shows explicit causal structure well. The current graph is incomplete, and value does not follow from graph position.

Use dependencies as evidence and leverage signals. Keep the narrative responsible for explaining their meaning.

### 13.5 A scheduled daily or weekly review

A schedule can help form a habit. It cannot solve the acute reorientation need after sickness, fatigue, or context switching.

It also violates the quiet-work contract when it appears automatically. A process can open the briefing only after Julian explicitly chooses that behavior.

### 13.6 An audio-first briefing

Audio can feel more like being told a story. It also prevents fast scanning and makes evidence comparison harder.

Keep text as the core contract. Optional read-aloud can reuse the same sequence later.

## 14. Risks, assumptions, and unknowns

### 14.1 Risks

- The narrator can create a persuasive but wrong frame.
- Sparse `Current`, due, actor, and dependency data can weaken the story.
- Five chapters can become another review ritual.
- A persistent working plan can become stale.
- Batch suggestions can overvalue convenience.
- A model can infer causality from names that only imply a relationship.
- The briefing can duplicate an Area brain's own planning story.

The evidence contract, omitted-work control, source times, and explicit acceptance reduce these risks. They do not remove them.

### 14.2 Assumptions

- Julian wants one cross-Area story within the current Work scope.
- Area Purpose and `Current` remain the best recorded sources for value and position.
- Goal results, dependencies, people, and due values can support the detailed chapters.
- One short accepted plan helps more than a transient recommendation.
- Work remains the preferred execution surface after reorientation.

### 14.3 Unknowns

- Which component authors a cross-Area story without breaking Area-brain ownership.
- Which existing object stores the working plan.
- How often the source material contains enough value and time evidence.
- Whether Julian prefers the five-step path or mostly uses the short version.
- Whether the plan line belongs in Work after several days.

These unknowns affect implementation and validation. They do not change the selected product model.

### 14.4 Reconsideration conditions

If Julian usually leaves after the short version, reconsider the separate surface. The short version can then become a controlled Work disclosure.

If Julian often corrects causal or priority suggestions, reduce interpretation. The product can shift toward a recorded-facts briefing.

If batch proposals rarely change action, remove them. Preserve actor and time grouping as comprehension aids.

If the working plan often becomes stale before reuse, make it temporary. Keep the accepted plan in briefing history.

Add optional audio only after the text flow succeeds. Audio must never contain evidence that the text view omits.

## 15. Validation

Use the observed 31-Goal Neara snapshot as the first validation fixture. Preserve the missing `Current`, due process, duplicate title, and old approvals.

Ask Julian to do these tasks in Work and in the proposed briefing:

1. Explain the main project situation.
2. Name the nearest recorded commitment.
3. Identify the next actor for selected work.
4. Find one action that unlocks other work.
5. Find one useful batch.
6. Reconsider one old Goal without treating age as value.
7. Choose the next work and explain the choice.

Run at least one validation during a real low-energy period. Do not manufacture sleep deprivation or illness.

If the briefing takes longer than manual reconstruction, the design fails. It also fails when Julian must read a chapter twice.

If a hidden omission changes the chosen priority, the design fails. It also fails when a suggestion cannot show evidence and reason.

The design passes only when the accepted working plan feels like Julian's synthesis. The narrator's recommendation is not the success measure.

## 16. Sources

### 16.1 Repository evidence

- [Agent Shell daily product](../../decisions/ADR-0017-agent-shell-daily-product.md)
- [Agent Shell operating vision](../agent-shell-operating-vision/design-record.md)
- [Compressed Work hierarchy](../agent-shell-compressed-work-hierarchy.md)
- [Work-view sub-Areas](../work-view-sub-areas/design-record.md)
- [Goal narrative projection](../../../packages/agent-shell/app/public/goal-narrative.js)
- [Area-note freshness signal](../../../packages/agent-shell/app/area-note-links.mjs)
- [Work Desk projection](../../../packages/agent-shell/app/public/work-desk-view.js)
- [Recent closures view](../../../packages/agent-shell/app/public/what-happened-view.js)
- [Vault index and Goal fields](../../../packages/agent-shell/app/server.mjs)
- Screenshot supplied by Julian on 2026-08-28.
- `tangent area list` and `tangent goal list neara --subtree --status open --json`, observed on 2026-08-28.

### 16.2 External evidence

- Lim and Dinges, [short-term sleep deprivation meta-analysis](https://pubmed.ncbi.nlm.nih.gov/20438143/), 2010.
- Altmann and Trafton, [Memory for goals](https://doi.org/10.1016/S0364-0213(01)00058-1), 2002.
- Altmann and Trafton, [Task interruption, resumption lag, and cues](https://interruptions.net/literature/Altmann-CogSci04.pdf), 2004.
- Endsley, [Situation awareness in dynamic systems](https://doi.org/10.1518/001872095779049543), 1995.
- Zwaan and Radvansky, [Situation models in comprehension and memory](https://doi.org/10.1037/0033-2909.123.2.162), 1998.
- Risko and Gilbert, [Cognitive offloading](https://doi.org/10.1016/j.tics.2016.07.002), 2016.
- Masicampo and Baumeister, [Plan making and unfinished goals](https://doi.org/10.1037/a0024192), 2011.
- Trope and Liberman, [Construal-level theory of psychological distance](https://pmc.ncbi.nlm.nih.gov/articles/PMC3152826/), 2010.
- Rubinstein, Meyer, and Evans, [Executive control in task switching](https://pubmed.ncbi.nlm.nih.gov/11518143/), 2001.
- Shneiderman, [The Eyes Have It](https://hci.stanford.edu/courses/cs448b/papers/shneiderman96eyes.pdf), 1996.
- Segel and Heer, [Narrative visualization](https://homes.cs.washington.edu/~jheer/files/narrative.pdf), 2010.
- Hullman and Diakopoulos, [Framing effects in narrative visualization](https://www.hullmanlab.northwestern.edu/paper/2011/02/01/vis-rhetoric.html), 2011.
- Blalock and Reyna, [Fuzzy-trace theory review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4979567/), 2016.
- Starmer and colleagues, [I-PASS handoff program](https://pubmed.ncbi.nlm.nih.gov/25372088/), 2014.
