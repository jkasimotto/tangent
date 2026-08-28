# Agent Shell orientation: a Root brain remembers my perspective

Date: 2026-08-28

Status: revised product vision. This record supersedes the structured Work Briefing from commit `074a98d`.

Lenses applied: UI/UX, and architecture, types, and data.

This record does not select an implementation plan.

## 1. Decision summary

Try a conversation-only product before Tangent adds a visual presentation system.

Make **Root** a visible Area above every current top-level Area. Its brain provides one place for thoughts and orientation across all work.

Add an explicit **Spew** action inside every Area-brain conversation. It accepts long typed text or dictated speech.

Tangent saves the complete Spew in that Area's Journal before the brain interprets it. Ordinary chat does not enter the Journal by default.

The brain can find passages that belong in other Areas. It proposes one batch of exact excerpts after the full Spew is safe.

Julian approves the batch before Tangent writes those excerpts to other Area Journals. Routing never blocks the original capture.

Later, Julian says “orient me” to an Area brain. The brain reads saved perspective, current work, and reliable activity evidence.

It tells a natural story in the normal conversation. Activity explains attention. It does not define priority.

Do not add a briefing screen, a fixed report, or A2UI to the first trial.

A later **Show me** experiment can turn a good story into a paced visual presentation. A2UI is one candidate format for that layer.

## 2. Why the design changed

Julian rejected the first example because it was an inventory, not a story.

It led with Goal counts, old dates, duplicate titles, dependencies, and missing fields. Those facts did not contain Julian's meaning.

The first correction was simple:

> I can talk out loud about my perspective on the projects. That gets saved and read later when I want orientating.

The second correction made capture and scope clearer:

> I would want to really just have a brain spew option when chatting to brains.

> We can just add a Root Area that contains all other Areas.

Julian also raised agent-controlled visual presentation, including A2UI. He prefers a nonvisual trial first.

The revised design follows that order. First preserve personal meaning. Then prove that a brain can return it as a useful story.

Only then test a richer presentation.

## 3. Problem contract

### 3.1 Root problem

Fatigue, illness, deep work, and context changes can remove the felt model of a project from working memory.

The missing model contains more than state. It contains importance, intent, doubts, temporary detours, and promises to return.

Agent Shell preserves project facts. It does not reliably preserve Julian's interpretation of those facts for a future brain.

The blocked outcome is continuity with an earlier self.

### 3.2 Success

The product succeeds after Julian can do these things:

1. Open Root and speak about all current work without preparing an outline.
2. Make one aside about another Area without losing it.
3. Return with a fresh brain and say “orient me.”
4. Receive a short story that restores the important tension and next decision.
5. Continue the same conversation into questions or work.

A useful answer explains:

- What Julian last thought mattered.
- Which work received attention after that point.
- Why attention moved, if the Journal contains a reason.
- Which important thread stayed unfinished.
- Which older work now connects to a current concern.
- Which decision controls the next move.

It sounds like a colleague who remembers the work. It does not sound like a database query.

### 3.3 Constraints

- Spew must accept ordinary speech or text.
- Tangent must save the complete input before model work.
- Capture must not ask for classification or routing first.
- One source Journal must retain the complete Spew.
- Cross-Area routes must preserve exact excerpts and source identity.
- One approval can authorize one proposed routing batch.
- Routing must create no Goal and grant no work authority.
- The selected Area and its descendants define the reading scope.
- Root must cover the complete Area tree.
- Activity can describe attention. It cannot define importance.
- Text must remain the complete first experience.

### 3.4 Non-goals

- Saving every terminal message to a Journal.
- A separate Work Briefing application.
- A fixed narrative template in the interface.
- A universal priority score.
- Automatic reprioritization.
- Automatic creation of Goals from a Spew.
- Silent writes to another Area.
- A new agent type above Area brains.
- Agent-generated UI in the first trial.
- Automatic fatigue detection.

## 4. Current system

All statements in this section are Observed.

### 4.1 Area brains already provide the conversation

One Area brain belongs to one exact Area. Agent Shell shows its complete native agent terminal through xterm.

The browser does not parse brain output into host UI components. The brain can render terminal text and terminal-native interfaces only.

Work exposes **Open brain**, **Message brain**, and **Capture note** for an Area.

### 4.2 Journal capture already provides the notebook

**Capture note** accepts typed or dictated text.

The server writes the exact text to the selected Area's `journal.md`. Each entry includes its time and source.

The vault commit finishes before the brain receives the notice. A failed commit does not claim that the brain heard durable words.

The Journal archives itself after its size limit. Voice capture uses the same Journal-first route.

### 4.3 Cross-Area Journal routing already exists

A live brain can create a Question with an exact `route-journal` effect.

The effect names one destination Area and exact text. Julian must authorize its hashed revision.

After authorization, the server writes and commits the destination Journal entry. It records the source Area and notifies the destination brain.

The notice explicitly grants no authority.

This path already proves the core routing behavior. A later design can add one batch for more than one exact route.

### 4.4 The hierarchy has no single visible Root

The current Area list starts with top-level Areas such as `neara` and `otto`.

The vault root supplies inherited brain instructions. It is not a selectable Area with its own Journal and brain.

The product needs a first-class Root identity above the current paths. It does not need to move every current Area below a new folder.

The durable representation of Root remains an implementation Unknown.

### 4.5 Fixed visual surfaces already exist

Agent Shell owns fixed browser views for Work, Areas, Documents, and the Area map.

The Area map uses a fixed graph renderer and fixed interaction rules. A brain cannot compose or change that view.

These surfaces prove that Tangent can render visual information. They do not provide an agent-controlled presentation channel.

### 4.6 The brain has factual sources

Area notes contain purpose, current work, knowledge, and resources.

Goal files contain results, short stories, state, dependencies, and linked Documents.

The brain runtime records material milestones. Usage records agent activity and duration. The worklog records named focus time.

These records explain activity and change. The Journal supplies the personal interpretation that they lack.

Usage and worklog entries do not always map cleanly to an Area. Exact time by Area is an Unknown.

## 5. Research and transfer limits

### 5.1 Memory and interruption

Altmann and Trafton found a delay after task interruption. Relevant cues near the task reduced that delay.

**Consequence:** Julian's own earlier words are strong return cues. The orientation answer starts from them.

Endsley separates situation awareness into facts, meaning, and likely next states.

**Consequence:** Project records supply facts. The brain connects those facts to Julian's meaning before it suggests a next move.

Masicampo and Baumeister found less interference from unfinished goals after people made specific plans.

**Consequence:** The conversation can end in a concrete next move. Tangent does not need a new stored plan object.

Hullman and Diakopoulos show that narrative selection can steer a conclusion.

**Consequence:** The brain distinguishes Julian's words, recorded activity, and its own interpretation in normal language.

### 5.2 Agent-controlled UI

A2UI lets an agent send declarative JSON that describes a UI. A client maps those descriptions to its own trusted components.

The protocol supports streaming component and data updates. It does not run arbitrary agent code in the client.

As of 2026-08-28, A2UI names v0.9.1 as current and v1.0 as a candidate.

The basic catalogue contains text, layout, media, cards, tabs, and form controls. Rich charts need a custom catalogue component.

**Consequence:** A2UI can support a Tangent presentation layer. It does not decide which story is useful or which visual is honest.

Tangent still needs a structured agent-to-browser channel, a trusted component catalogue, and stable interaction rules.

### 5.3 Why text comes first

The failed briefing had a meaning problem, not a rendering problem.

A polished visual can make the same weak story more persuasive. It can also hide omissions behind pace and visual emphasis.

Text gives the cheapest test of memory, synthesis, and correction. A visual layer earns its place only after that test passes.

Sources remain in section 14.

## 6. Candidate decisions

### 6.1 Which messages become memory

| Candidate | Strength | Decisive problem |
|---|---|---|
| Save every brain message | No explicit capture action | Journals fill with questions, commands, and temporary chat |
| Brain summarizes the transcript later | Low interruption during chat | The durable record starts with a model interpretation |
| Explicit Spew | Clear user intent and exact source words | Julian must select the action |

Select explicit **Spew**.

### 6.2 Where all-work perspective lives

| Candidate | Strength | Decisive problem |
|---|---|---|
| Separate global narrator | Independent all-work product | It duplicates the Area-brain model |
| Choose one existing top-level Area | No new root identity | It makes unrelated work a child of the wrong subject |
| Visible Root Area | Same mental model at every scope | Root needs a new durable identity |

Select the visible Root Area.

### 6.3 How a Spew reaches other Areas

| Candidate | Strength | Decisive problem |
|---|---|---|
| Read only the source Journal later | One stored copy | A child brain can miss perspective captured elsewhere |
| Route silently | No later user action | A model can write the wrong Area memory |
| Propose exact routes after capture | Safe source plus useful distribution | Adds one small review after the conversation starts |

Select proposed exact routes. Group them into one optional batch.

### 6.4 How the brain presents orientation

| Candidate | Strength | Decisive problem |
|---|---|---|
| Normal text conversation | Fastest proof of the story | Complex relationships can need more inspection |
| Fixed briefing visual | Predictable rendering | It recreates a report before the story works |
| Agent-controlled UI | Adapts presentation to the story | It adds a renderer, catalogue, protocol, and new failure modes |

Select normal text for the first trial. Keep agent-controlled UI as a later experiment.

## 7. Selected product

### 7.1 Mental model

The product has one sentence:

> Spew what the work feels like into a brain. Ask that brain to give it back after the context is gone.

The Journal is the notebook. The Area brain is the reader and conversation partner. Root is the notebook for everything.

### 7.2 Root

Agent Shell shows **Root** above the current Area tree.

Root has the same brain actions and conversation as any other Area. It contains Neara, Otto, and every other top-level Area.

The Root brain can read the complete tree for orientation. Existing child-brain boundaries still govern work actions.

Julian uses Root for broad project perspective, personal attention, and thoughts that cross current Area boundaries.

He can still use Neara, Tangent, or any smaller Area for a focused Spew.

### 7.3 Spew

The brain session header includes **Spew**.

It opens one large text and voice input. Julian speaks or types without choosing a type, Goal, or route.

Tangent saves the complete input to the current brain's Journal. It then sends the same words into the brain conversation.

The brain can respond before Julian reviews any routes. The original thought is already safe.

Ordinary chat stays ordinary chat. Julian uses Spew again for a correction that must survive a fresh brain.

### 7.4 Cross-Area routing

The brain can find exact passages that matter to another Area.

After its normal response, it can offer one compact routing batch:

```text
Also remember elsewhere?

Neara  “PG&E still matters most…”
Tangent “The tool was blocking how I work…”

Route both · Change · Leave here
```

Approval copies the shown excerpts to the destination Journals with a link to the source Spew.

The brain does not paraphrase a route as if Julian said it. It can propose a longer exact passage after Julian selects **Change**.

Ignoring the offer loses nothing. The complete Spew remains in its source Journal.

### 7.5 Orientation

The first product adds no **Orient me** button.

Julian opens a brain and says “orient me,” “where was I,” or another natural version.

The brain reads:

1. Recent Spews and later corrections in the selected Area subtree.
2. Area Purpose and `Current` sections.
3. Open Goals and Goals changed after the last saved perspective.
4. Material milestones and completed work after that point.
5. Activity evidence with a reliable link to the scope.

Root reads the complete tree. A smaller Area brain reads its own subtree and relevant routed excerpts.

The first answer gives the main arc. Julian can interrupt, correct it, ask for evidence, or tell the brain to act.

### 7.6 What makes the answer a story

The answer starts with Julian's last meaningful view.

It relates later activity to that view:

- Work that received attention.
- A recorded reason for an attention shift.
- An important thread that remained open.
- An older idea with a current connection.
- The tension or decision that controls the next move.

The answer can recommend a direction. It does not cover every Area or Goal.

Counts and dates appear only to explain the story. They never become the story.

Attribution stays conversational:

- “You told me that…”
- “The recent work shows…”
- “I cannot tell whether…”
- “My read is…”

### 7.7 Representative scenario

Julian opens Root and selects **Spew**:

> PG&E is still the job that matters. I spent this week on Tangent because the tool was blocking how I work. Viz Input waits on reviews. Hackathon felt urgent before, but I no longer know whether it is. I want to batch the people work before I return to code.

Root saves the complete passage. The brain offers exact routes to Neara and Tangent after it responds.

After more work and another context change, Julian tells Root to orient him.

The brain can answer:

> Your last clear view was that PG&E still mattered most. Tangent temporarily took your attention because the tool itself was blocking you.
>
> The recent work supports the second part. Most recorded activity moved through Tangent. I cannot tell whether that detour now has a good stopping point.
>
> Inside Neara, Viz Input still appears to wait at the reviewer stage. That remains a natural people batch. You already questioned the old Hackathon urgency, so I do not revive it from age alone.
>
> The first decision is whether Tangent is now good enough to leave. After that, the clean return is the reviewer batch and the PG&E thread with the nearest external date.

This answer uses Julian's meaning as the spine. Work records explain what changed around it.

## 8. Visual presentation after the text trial

### 8.1 Product position

A visual story is a possible second layer, not a replacement for conversation.

The brain first forms a useful text story. Julian can then say **Show me**.

The presentation uses the same claims and evidence. It adds no new priority logic.

### 8.2 Visuals that can earn a place

| Relationship | Useful visual | Reason |
|---|---|---|
| Perspective and attention across time | Short timeline | Shows a detour and return point |
| One concern across Areas | Highlighted Area tree | Shows scope and routing |
| One decision with two or more consequences | Small decision fork | Shows what each choice changes |
| A few facts with no important relation | No visual | Prose is faster |

Time bars must say **attention**, never **priority**.

The presentation advances only after Julian starts it. He controls pause, next, back, and stop.

Every frame has a complete text equivalent. The last frame returns to the brain conversation.

### 8.3 A2UI fit

A2UI is a credible format for a later Tangent renderer because the agent sends data, not executable browser code.

Tangent keeps control of style, accessibility, components, and allowed actions through its catalogue.

A small Tangent catalogue can contain a story frame, Area trail, timeline, decision fork, and evidence link.

The basic A2UI catalogue alone does not provide these project visuals. Tangent must define and test them.

The current terminal connection also has no structured A2UI side channel. A later implementation design must define one.

Do not adopt the protocol before a fixed visual prototype proves useful.

## 9. UI/UX lens

### 9.1 First trial path

1. Julian opens the visible Root Area or another Area brain.
2. He selects **Spew** in the session header.
3. He types or dictates one long thought.
4. Tangent saves it and sends it to the current brain.
5. The brain responds in the native conversation.
6. The brain offers optional exact routes after the response.
7. Later, Julian opens a brain and asks for orientation in normal language.

No new navigation mode appears.

### 9.2 Important states

**No saved perspective:** The brain says that it has project records but no personal view to restore.

**Mixed Spew:** The full input stays in the source Journal. Route proposals separate only exact excerpts.

**Wrong route:** Julian changes or declines it. No destination write occurs.

**Ignored route:** The complete source remains available to the source brain.

**No destination brain:** The routed Journal entry remains. A future brain reads it.

**Live child brain:** Root can read its records for orientation. Existing territory rules still control work mutations.

**No recent activity:** The brain uses saved perspective and current notes. It states that activity evidence is absent.

**Incomplete Area mapping:** The brain avoids exact time claims.

**Capture error:** The Spew stays in the composer. The surface does not claim that it was saved.

**Model error:** The Journal remains safe. Julian can retry with a fresh brain.

### 9.3 Cognitive cost

The first trial adds two visible elements: Root and Spew.

It adds no orientation questionnaire, chapter controls, evidence badges, plan editor, or generated dashboard.

The route review comes after value and never blocks capture.

## 10. Architecture, types, and data lens

### 10.1 One owner for each fact

| Fact | Authority |
|---|---|
| Complete freeform Spew | Source Area Journal |
| Exact routed excerpt | Destination Area Journal with source identity |
| Present Area purpose and situation | Area note |
| Goal result, state, story, and dependencies | Goal files |
| Brain delivery and lifecycle | Area-brain runtime records |
| Agent activity and duration | Usage index |
| Named personal focus time | Worklog |
| Orientation story | Derived brain response |
| Visual presentation | Derived transient surface |

### 10.2 Invariants

1. Tangent saves a Spew before it delivers or interprets the Spew.
2. One source Journal retains the complete input.
3. A route contains exact user text, destination Area, and source identity.
4. No destination write occurs before Julian approves the route batch.
5. Routing a Journal excerpt grants no work authority.
6. Root can read the complete tree for orientation.
7. Existing live brain territories govern work mutations.
8. Activity evidence never changes recorded purpose or priority.
9. An orientation response changes no durable state by itself.
10. A generated visual changes no durable state by itself.
11. A user correction becomes a later Spew, not a silent rewrite.

### 10.3 Existing leverage

Journal capture already provides commit-before-delivery, archives, idempotency, voice input, and brain wake behavior.

The `route-journal` Request effect already provides exact text, explicit authorization, destination commit, provenance, and destination notice.

The first implementation can compose these capabilities. It does not need a new memory database.

### 10.4 Material unknowns

The vault root has no ordinary Area identity today. A later design must add Root without changing every current Area path.

The existing route effect handles one destination. A product-quality Spew needs one compact batch for more than one destination.

Usage sessions do not have complete Area identity. A later design must define which activity claims are safe.

The native terminal carries bytes, not structured UI messages. An A2UI experiment needs a separate trusted channel.

## 11. Detailed decisions

1. **Try text first.** Do not build visual presentation before a real orientation trial passes.
2. **Add Root as an Area in the product model.** Use the normal Area-brain experience at all-work scope.
3. **Keep child brains.** Root does not replace focused brains or their work authority.
4. **Add explicit Spew inside brain chat.** Do not save every ordinary message.
5. **Save the complete input first.** Classification and routing happen later.
6. **Use the existing Journal.** Do not create a perspective schema.
7. **Propose exact cross-Area excerpts.** Do not silently distribute model summaries.
8. **Approve routes as one batch.** Do not make capture wait for that approval.
9. **Keep “orient me” as language in the first trial.** Add a button only after repeated use proves its value.
10. **Start from Julian's words.** State and activity explain change around them.
11. **Treat time as attention, not priority.** Keep unknown mapping explicit.
12. **Keep generated stories transient.** Durable truth stays in Journals, Area notes, Goals, and Documents.
13. **Consider “Show me” later.** A visual presentation is optional and user-started.
14. **Treat A2UI as a candidate format.** It is not the product decision.
15. **Use trusted visual components.** An agent never sends executable browser code.

## 12. Rejected alternatives

### 12.1 Keep the five-stage briefing

This direction forces a tired user through a review ritual. It also fills a structure from weak system signals.

### 12.2 Save every brain message

This direction removes one explicit action. It also mixes durable perspective with transient questions and commands.

### 12.3 Make Root a separate narrator product

This direction creates a second agent model and a new authority boundary.

Root is an Area. It uses the same brain, Journal, and conversation rules.

### 12.4 Let Root silently rewrite child memory

This direction removes routing friction. It also lets a model misquote Julian inside another subject.

Exact routes with one later approval keep capture fast and memory honest.

### 12.5 Read all Journals from every brain

This direction avoids routing. It exposes unrelated personal context and increases retrieval noise.

Area scope plus routed excerpts gives each brain relevant memory.

### 12.6 Build A2UI first

This direction creates an impressive demo before Tangent proves the story.

It also adds protocol generation errors, rendering errors, interaction state, accessibility work, and visual framing risk.

### 12.7 Let activity generate the story

Time and recency show attention, not value.

The rejected Neara example already demonstrated the result: correct facts with no human meaning.

## 13. Risks, reconsideration, and validation

### 13.1 Risks

- Julian can forget to use Spew for a durable correction.
- A long Root Journal can contain noise and temporary thoughts.
- A brain can select the wrong passage for a route.
- Route approval can become a chore after every Spew.
- Root can produce a broad story with too little depth.
- Activity evidence can miss human work.
- A natural story can sound persuasive while it is wrong.
- A visual story can amplify that persuasion.

Exact source words, optional routing, normal conversation, and staged validation reduce these risks.

### 13.2 Reconsideration conditions

If Julian often forgets Spew, let the brain offer to save a clear correction after normal chat.

If route review becomes repetitive, test a narrow standing rule for named Areas. Do not make silent routing the default.

If Root becomes too broad, orient from one selected Area and use Root only for cross-work capture.

If Journal noise harms orientation, add a brain-maintained summary with links to exact entries.

If text repeatedly hides a timeline, tree, or decision relation, prototype one fixed visual.

If that prototype helps, compare a Tangent-native format with A2UI before protocol adoption.

### 13.3 First validation: memory and story

Use Root, Neara, and Tangent over three real days.

Julian records:

1. One all-work Spew in Root.
2. One Neara Spew with a Tangent aside.
3. One later correction.
4. One approved route and one declined route.

Then a fresh Root brain and a fresh Neara brain each receive a natural orientation request.

The design passes after the answers do these things:

1. Start from Julian's latest meaningful perspective.
2. Relate an attention shift without treating time as value.
3. Recall the routed Tangent aside in the correct scope.
4. Treat the correction as current and the earlier view as history.
5. Name one material unknown.
6. Lead to a useful conversation without a setup questionnaire.

The need to repeat the old context means that the design fails.

An inventory that project counts alone can produce also means that the design fails.

### 13.4 Second validation: visual value

Run this validation only after the text trial passes.

Use one real story with a meaningful sequence or Area relationship. Compare the text answer with one read-only visual prototype.

The visual earns a second iteration only after Julian prefers it for orientation and can explain the relationship more easily.

Beauty alone is not a pass condition.

## 14. Sources

### 14.1 Repository and vault evidence

- [Root Area-brain instructions](/Users/julianotto/.tangent/trees/AGENTS.md)
- [Tangent Area note](/Users/julianotto/.tangent/trees/otto/tangent/tangent.md)
- [Journal domain](../../../packages/agent-shell/app/area-brain-domain.mjs)
- [Journal and message routes](../../../packages/agent-shell/app/server.mjs)
- [Request effects](../../../packages/agent-shell/app/brain-requests.mjs)
- [Journal production-path tests](../../../packages/agent-shell/app/area-brain-production-path-http.test.mjs)
- [Brain terminal view](../../../packages/agent-shell/app/public/goal-launch-view.js)
- [Terminal controller](../../../packages/agent-shell/app/public/terminal-controller.js)
- [Area map](../../../packages/agent-shell/app/public/area-map.js)
- [Capture composer](../../../packages/agent-shell/app/public/work-desk-view.js)
- [Voice route](../../../packages/agent-shell/app/voice-routes.mjs)
- [Area brain design](/Users/julianotto/.tangent/trees/otto/tangent/design-area-brain.md)
- [Audited Area-brain workflow](/Users/julianotto/.tangent/trees/otto/tangent/design-audited-area-brain-workflow.md)

### 14.2 External evidence

- Altmann and Trafton, [task interruption, resumption lag, and cues](https://interruptions.net/literature/Altmann-CogSci04.pdf), 2004.
- Endsley, [situation awareness in dynamic systems](https://doi.org/10.1518/001872095779049543), 1995.
- Masicampo and Baumeister, [plan making and unfinished goals](https://doi.org/10.1037/a0024192), 2011.
- Hullman and Diakopoulos, [framing effects in narrative visualization](https://www.hullmanlab.northwestern.edu/paper/2011/02/01/vis-rhetoric.html), 2011.
- A2UI project, [architecture and project status](https://github.com/a2ui-project/a2ui).
- A2UI project, [v1.0 candidate protocol](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/a2ui_protocol.md).
- A2UI project, [basic catalogue concepts](https://a2ui.org/concepts/catalogs/).
