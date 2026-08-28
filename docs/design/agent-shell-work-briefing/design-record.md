# Agent Shell orientation: brains remember complete user turns

Date: 2026-08-28

Status: revised product vision. This record supersedes the structured Work Briefing from commit `074a98d`.

Lenses applied: UI/UX, architecture, types and data, and migration and compatibility.

This record does not select an implementation plan.

## 1. Decision summary

Use normal brain conversation. Do not add a Spew button, composer, mode, or new screen.

An explicit phrase such as “remember this” marks the complete current user turn for durable capture.

Tangent saves the exact submitted text before the brain interprets it. The brain then responds as it normally responds.

Root saves its complete turns in `~/.tangent/trees/journal.md`.

An Area brain saves its complete turns in `~/.tangent/trees/<area>/journal.md`.

The source Journal entry is the canonical record of what Julian said. Tangent does not replace those words with a model summary.

The brain can route an exact excerpt to another Area Journal after Julian approves that route in conversation.

Area notes and Goals remain the current project truth. Journals preserve perspective, corrections, and history.

Root remains the visible all-work Area. It maps to the vault root instead of a new folder around all current Areas.

Orientation remains normal conversation. Visual presentation remains a later experiment.

## 2. Why the design changed

The first design created a structured briefing from Goal counts, dates, and other project facts.

Julian rejected that result because it was an inventory without his meaning.

The next design added an explicit Spew action. Julian rejected the new UI concept:

> If I say a keyword while talking to a brain, it just does spew.

> We need to save my exact words.

> It is probably good to save the entirety of what I was saying in one place. And then the rest can get routed as well.

The corrected design removes Spew as a product object.

The durable event is one ordinary user turn. The user can mark that turn with ordinary save language.

## 3. Problem contract

### 3.1 Root problem

Fatigue, illness, deep work, and context changes can remove the felt model of a project from working memory.

The missing model contains importance, intent, doubts, temporary detours, and promises to return.

Agent Shell preserves project facts. It does not reliably preserve Julian's interpretation of those facts for a future brain.

The blocked outcome is continuity with an earlier self.

### 3.2 Success

The product succeeds after Julian can do these things:

1. Talk to a brain in the normal terminal.
2. Say “remember this” during one important user turn.
3. Return with a fresh brain and ask for orientation.
4. Receive a short story that restores the important tension and next decision.
5. Find the complete original words in one readable Markdown file.

A mixed-Area turn also succeeds after an approved exact excerpt appears in the correct destination Journal.

### 3.3 Constraints

- The capture path must add no new input surface.
- An explicit save request must cause durable capture.
- The capture unit must be the complete user turn.
- The stored text must match the submitted user text.
- The model must not retype the text to make the canonical record.
- One source Journal must retain the complete turn.
- A routed entry must contain an exact excerpt and a source entry reference.
- A route must create no Goal and grant no work authority.
- Root must cover the complete Area tree.
- Activity can describe attention. It cannot define importance.
- The brain must acknowledge a successful save in normal conversation.
- A failed save must never receive a success acknowledgement.

### 3.4 Non-goals

- A Spew button or capture composer inside brain chat.
- A special memory conversation mode.
- Saving every user turn.
- Automatic capture based only on model opinion.
- Rewriting Julian's words into Simple English.
- Automatic creation of Goals from a saved turn.
- Silent writes to another Area.
- A separate Work Briefing application.
- Agent-generated UI in the first trial.

## 4. Research that shapes the product

This research supports a small conversational design. It does not require a new workflow or data model.

### 4.1 Make capture an offload, not another task

Risko and Gilbert describe cognitive offloading as action that reduces the mental demand of a task.

**Product consequence:** Use the conversation that is already open. Do not ask Julian to select a type, complete a form, or organize the thought first.

### 4.2 Preserve useful return cues

Altmann and Trafton found a delay after task interruption. Cues from the interrupted task reduced that delay.

**Product consequence:** Start orientation from Julian's earlier words. Those words can restore context before the brain adds current project facts.

The paper does not compare verbatim text with a summary. The preference for verbatim text is a product inference and an explicit user requirement.

### 4.3 Rebuild facts, meaning, and the next state

Endsley describes situation awareness in three parts: perceived facts, their meaning, and their likely future state.

**Product consequence:** The brain first recalls Julian's meaning. It then explains material changes and the next decision.

This order is progressive disclosure. It avoids a complete inventory before the user has regained the main story.

### 4.4 Give an open loop a usable stopping point

Masicampo and Baumeister found that unfinished goals can interfere with other work. A specific plan reduced that interference in their studies.

**Product consequence:** An orientation can end with one clear next decision or action. Tangent does not need a new stored plan object for this result.

### 4.5 Keep interpretation visible

Hullman and Diakopoulos show that narrative presentation can favor one interpretation through selection and framing.

**Product consequence:** The brain distinguishes Julian's words, recorded facts, and its own interpretation. A later visual layer must preserve the same distinction.

## 5. Current system

All statements in this section are Observed.

### 5.1 Brain chat is a native terminal

One Area brain belongs to one exact Area. Agent Shell shows its complete native agent terminal through xterm.

The browser transports terminal bytes. It does not expose a host-level user-message event to the surrounding Agent Shell UI.

This fact makes exact capture a material implementation problem. A model-produced copy is not an exactness guarantee.

### 5.2 Journal capture already stores exact text

The existing Journal writer accepts an Area, text, an entry identifier, a source label, and a time.

It writes this Markdown shape:

```markdown
# Journal

<!-- tangent-journal:<entry-id> -->
## <ISO timestamp>

Source: <source>.

<exact submitted text>
```

The writer keeps internal whitespace and removes surrounding whitespace. It writes one stable marker for retry safety.

The vault commit finishes before the brain receives the notice. A failed commit does not claim that the words are durable.

The active Journal moves to a dated archive after 256 KiB. The new `journal.md` links to that archive.

### 5.3 Existing capture uses a separate composer

Work has **Capture note**. It accepts typed or dictated text and uses the Journal-first route.

Voice capture stores the transcript as the submitted text. It does not store the audio.

The new design reuses the storage path. It removes the need to open this composer during brain chat.

### 5.4 Existing remember behavior saves conclusions

The global `remember` skill recognizes phrases such as “remember that,” “save that,” and “record this.”

Its current contract saves the conclusion to one current Area record. It explicitly rejects transcript storage.

That behavior serves current project truth. It does not preserve Julian's complete perspective for later orientation.

The new Journal capture is an earlier layer. It saves the complete requested turn before the brain harvests any current fact.

### 5.5 Cross-Area Journal routing already exists

A live brain can create a Question with an exact `route-journal` effect.

The effect names one destination Area and exact text. Julian authorizes the exact effect revision.

After authorization, the server writes and commits the destination Journal entry. It records the source Area and notifies the destination brain.

The notice explicitly grants no authority.

The current route records the source Area. The revised storage contract also needs the source Journal entry identifier.

### 5.6 Root is not a current Area identity

The current Area list starts with top-level Areas such as `neara` and `otto`.

The vault root already contains their directories and the inherited brain instructions.

It is the natural physical home for the Root Journal. The current Area APIs reject this empty Area identity.

The visible Root Area therefore needs one special identity that maps to the vault root.

## 6. Candidate decisions

### 6.1 How the user asks for capture

| Candidate | Strength | Decisive problem |
|---|---|---|
| Save every user turn | No explicit request | The Journal fills with temporary questions and commands |
| Add a Spew control | Clear state | It creates a new mode for an ordinary conversation need |
| Let the model save anything important | No keyword | The user cannot predict or control durable capture |
| Use normal save language | No new UI and explicit intent | The turn boundary must be available outside model output |

Select normal save language.

The first guaranteed phrase is **“remember this.”** The typed `/remember` form can provide the same behavior.

If no phrase exists, the brain can ask, “Save that complete turn?” It must not save the turn before Julian agrees.

### 6.2 What Tangent saves

| Candidate | Strength | Decisive problem |
|---|---|---|
| Model summary only | Compact | It loses voice, uncertainty, and omitted context |
| Native transcript only | Already exists | A future Area brain does not use transcripts as file memory |
| One file per turn | Direct links | It creates file volume for one continuous human history |
| Complete turn in the Journal | Existing path and readable sequence | A long Journal needs archives and selective reading |

Select the complete turn in the Journal.

### 6.3 Where Root stores its Journal

| Candidate | Strength | Decisive problem |
|---|---|---|
| `~/.tangent/trees/root/journal.md` | Uses a normal nonempty Area path | The folder does not contain Neara or Otto |
| `~/.tangent/root-journal.md` | No vault changes | The record leaves the git vault and Obsidian tree |
| `~/.tangent/trees/journal.md` | Root and its children share the same physical tree | Root needs a special Area identity in APIs |

Select `~/.tangent/trees/journal.md`.

The visible Root maps to the vault root. No Area paths move.

### 6.4 How other Areas receive relevant parts

| Candidate | Strength | Decisive problem |
|---|---|---|
| Every brain reads every Journal | No copies | It exposes unrelated context and adds retrieval noise |
| The model routes a summary | Compact | It can change Julian's meaning |
| The model silently routes exact excerpts | Fast | It can put private or irrelevant words in the wrong Area |
| Julian approves an exact excerpt | Clear source and controlled scope | It adds one normal conversation decision |

Select an approved exact excerpt with a source entry reference.

## 7. Selected conversation behavior

### 7.1 No new UI

Julian talks to a brain as he does today.

He can say:

> Remember this. PG&E still matters most. Tangent took this week because the tool was blocking how I work.

The brain does not enter a new mode. It does not open a form or change the conversation layout.

Tangent saves the complete user turn. The brain then responds to its meaning.

The response starts with a small receipt:

> Saved verbatim to the Root Journal.

The brain can continue its normal answer after that sentence.

### 7.2 The cue marks the complete turn

The capture includes the complete user turn, not only the words after “remember this.”

The saved body includes the cue because the source record remains verbatim.

The turn can contain more than one Area, uncertainty, repetition, and unfinished sentences. Tangent does not clean or classify it before the save.

If the input comes from speech, Tangent saves the exact transcript that the agent received.

### 7.3 The cue is explicit but not rigid

“Remember this” is the first guaranteed phrase. The brain can understand equivalent direct requests such as “save this complete thought.”

The user does not need a new product word.

The brain can notice an unmarked perspective dump. In that case, it can offer capture after its answer.

The offer is a normal question. Silence or a negative answer causes no Journal write.

## 8. Concrete storage contract

### 8.1 Canonical paths

| Conversation scope | Complete source turn |
|---|---|
| Root | `~/.tangent/trees/journal.md` |
| Neara | `~/.tangent/trees/neara/journal.md` |
| Tangent | `~/.tangent/trees/otto/tangent/journal.md` |
| Any other Area | `~/.tangent/trees/<area>/journal.md` |

Archived entries remain beside the active Journal as `journal-<from>-<to>.md`.

### 8.2 Source entry

One remembered Root turn has this form:

```markdown
# Journal

<!-- tangent-journal:01K4... -->
## 2026-08-28T04:15:00.000Z

Source: Root brain conversation.

Remember this. PG&E still matters most. Tangent took this week because the tool was blocking how I work.
```

The hidden entry identifier provides retry protection and route provenance. The time orders entries.

The `Source` line uses simple English. The body remains Julian's exact submitted text.

### 8.3 Routed entry

If Julian approves the Tangent passage, Tangent writes this form to `otto/tangent/journal.md`:

```markdown
<!-- tangent-journal:01K5... -->
## 2026-08-28T04:16:00.000Z

Source: Routed from Root Journal entry 01K4....

Tangent took this week because the tool was blocking how I work.
```

The routed body is an exact excerpt. It is not a summary and it does not replace the source entry.

The source entry remains canonical. The route makes that context local to the destination brain.

### 8.4 Corrections are new entries

Tangent never edits an old remembered turn.

Julian can say:

> Remember this correction. Tangent is no longer blocking me. The customer review on Tuesday now controls PG&E.

The correction becomes a later source entry. Approved routes become later destination entries.

A future brain reads the sequence and treats the later explicit correction as current perspective.

### 8.5 Journals and current truth have different jobs

The Journal answers, “What did Julian say and how did his view change?”

An Area note answers, “What is true and current for this Area?”

A Goal answers, “Which result exists and what is its current state?”

The brain can use a remembered turn to update an Area note or Goal through the normal workflow.

The raw turn does not become project truth merely because Tangent saved it.

### 8.6 One source, local routes

```text
Root brain user turn
        │
        ├── complete verbatim source ──→ ~/.tangent/trees/journal.md
        │
        ├── exact Neara excerpt ───────→ neara/journal.md
        │
        └── exact Tangent excerpt ─────→ otto/tangent/journal.md
```

The full turn exists in one canonical place. Routed excerpts provide local recall without a second complete copy.

## 9. Orientation behavior

Julian opens Root, Neara, Tangent, or another brain. He says “orient me,” “where was I,” or another natural version.

The brain reads:

1. Remembered turns and later corrections in scope.
2. Routed entries in the selected Area subtree.
3. Area Purpose and `Current` sections.
4. Open Goals and Goals changed after the last remembered turn.
5. Material milestones and completed work after that point.
6. Activity evidence with a reliable Area link.

Root reads the complete tree. A smaller Area brain reads its subtree and local routed entries.

The answer starts with Julian's last meaningful view. Project records explain what changed around it.

Time spent remains evidence of attention, not priority.

The answer can use these phrases:

- “You said…”
- “The recent work shows…”
- “I cannot tell whether…”
- “My read is…”

## 10. Visual presentation remains later

The first trial stays in the native text conversation.

Agent Shell has fixed visual surfaces. The Area map is one example. A brain cannot compose the surrounding browser UI today.

A2UI can support a later trusted presentation layer. The agent sends declarative component data, and the client controls the component catalog.

This layer can show a short timeline, highlighted Area tree, or decision fork after the text story works.

It does not change the storage contract. Every visual remains a derived view of Journals and current project records.

## 11. Lens analysis

### 11.1 UI/UX

The common path uses the existing brain terminal:

1. Julian sends one normal user turn with an explicit save phrase.
2. Tangent saves the turn before the brain claims success.
3. The brain gives one short receipt and its normal response.
4. The brain asks a normal routing question only after the source is safe.
5. Julian later requests orientation in normal language.

The design adds one visible Root row. It adds no control inside the terminal.

**No cue:** The turn remains normal chat. The brain can offer capture but cannot save silently.

**Save error:** The brain says that the Journal save failed. The native transcript still contains the turn.

**Duplicate delivery:** The native user-message identifier becomes the Journal entry identifier. Tangent writes one entry.

**No destination brain:** The routed Journal entry remains for a future brain.

**Wrong route:** Julian declines the exact route. The source entry remains safe.

**Voice error:** Tangent stores the transcript that reached the agent. It does not claim fidelity to the audio.

### 11.2 Architecture, types, and data

| Fact | Authority |
|---|---|
| Exact submitted user turn | Source Journal entry |
| Exact routed excerpt | Destination Journal entry with source identifier |
| Current Area purpose and situation | Area note |
| Goal result and state | Goal file |
| Native conversation | Provider transcript and Usage index |
| Agent activity and duration | Usage index |
| Orientation story | Derived brain response |

The capture mechanism must reference the native user message. The model can request the save but cannot supply the canonical text.

The native message identifier also supplies idempotency. A retry writes no second Journal entry.

The Journal remains append-only at the product level. Git commits preserve provenance.

The route is a derived access copy. It names the source entry and cannot become the authority for the complete turn.

### 11.3 Migration and compatibility

Existing Area Journals already use the selected Markdown envelope. Old entries remain readable without migration.

New routed entries add the source entry identifier to the existing `Source` line. Old routed entries remain valid with Area-only provenance.

The existing `remember` skill can continue to save a conclusion to its current home.

The new capture layer saves the raw turn first. These writes have different authority and do not compete.

Root adds a new Journal at the vault root. It moves no Area and changes no existing Area path.

Rollback can stop automatic cue capture. All written Journal files remain normal Markdown and remain readable.

## 12. Invariants and detailed decisions

1. **Use ordinary brain conversation.** Add no Spew UI or mode.
2. **Use explicit save language.** “Remember this” is the first guaranteed phrase.
3. **Save the complete user turn.** Do not save only the phrase after the cue.
4. **Use native message text.** Do not ask the model to reproduce the canonical words.
5. **Save before acknowledgement.** A success receipt means that the vault commit finished.
6. **Use one canonical source Journal.** Root uses the vault-root Journal.
7. **Use exact routed excerpts.** Each route names its source entry.
8. **Require approval for another Area.** A route is a normal conversation decision.
9. **Keep Journals append-only.** Corrections become later entries.
10. **Keep current truth separate.** Area notes and Goals retain their current roles.
11. **Use the current Journal format.** Add no perspective schema or database.
12. **Keep orientation conversational.** Add no required command or button.
13. **Try text first.** A2UI remains a later presentation experiment.

## 13. Rejected alternatives

### 13.1 Keep a Spew button

The control makes durable capture visible. It also creates a new mode for an ordinary sentence to a brain.

An explicit save phrase provides intent without a new interface object.

### 13.2 Let the brain summarize before storage

A summary can remove hesitation, uncertainty, and cross-Area context that matters later.

Save the complete source first. The brain can derive current state after that save.

### 13.3 Use native transcripts as the only memory

Native transcripts preserve exact conversation. Fresh Area brains do not use them as file memory.

The Journal makes selected turns durable, scoped, readable, and available across agent generations.

### 13.4 Put Root in a `root/` folder

That folder does not contain Neara or Otto. Moving all Areas into it changes every durable Area path.

The vault root already contains the complete tree.

### 13.5 Copy the complete turn to every mentioned Area

This direction makes every brain self-contained. It also creates duplicate complete records and exposes unrelated context.

Keep one complete source. Route only exact relevant excerpts.

### 13.6 Route without approval

Silent routing is fast. It can put private, irrelevant, or misclassified text in another Area.

One normal conversation question preserves user control.

## 14. Risks, unknowns, and validation

### 14.1 Risks

- Julian can forget the save phrase.
- A long Journal can contain temporary views and repetition.
- A brain can select the wrong route excerpt.
- A destination Journal can show an old view before its correction route arrives.
- Voice transcription can change spoken words.
- The current terminal boundary does not expose semantic user turns to Agent Shell.

### 14.2 Material unknown

The product contract requires exact submitted text from the native user message.

The current terminal transport carries bytes and the provider transcript records messages later.

A later implementation design must select a reliable message boundary and save trigger. It cannot use a model-generated copy.

### 14.3 Reconsideration conditions

If Julian often forgets the phrase, let the brain offer capture after a broad perspective turn.

If those offers become noisy, keep explicit save language only.

If routing questions become repetitive, test a narrow standing rule for named Areas.

If Journal noise harms orientation, add a derived summary with links to exact entries.

If exact voice fidelity matters, retain the source audio or require transcript review before submission.

### 14.4 Validation

Use Root, Neara, and Tangent over three real days.

Record these cases:

1. One remembered Root turn with Neara and Tangent content.
2. One ordinary unmarked turn that stays out of the Journal.
3. One approved exact route to Tangent.
4. One declined route.
5. One later correction.
6. One simulated save retry.

Then start fresh Root and Neara brains and request orientation.

The design passes after these facts are true:

1. The Root Journal body matches the submitted text.
2. A retry creates no duplicate entry.
3. The Tangent route matches an exact source excerpt and names its source identifier.
4. The correction remains later than the original.
5. The fresh brains restore the changed perspective.
6. The answers treat activity as attention and not priority.

The design fails if Julian must explain the old context again.

It also fails if the answer is only a list of Goals and dates.

## 15. Sources

### 15.1 Repository and vault evidence

- [Vault rules](/Users/julianotto/.tangent/trees/README.md)
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
- [Existing remember skill](/Users/julianotto/.claude/skills/remember/SKILL.md)

### 15.2 Human-factors evidence

- Risko and Gilbert, [cognitive offloading](https://doi.org/10.1016/j.tics.2016.07.002), 2016.
- Altmann and Trafton, [task interruption, resumption lag, and cues](https://escholarship.org/uc/item/18b4r661), 2004.
- Endsley, [situation awareness in dynamic systems](https://doi.org/10.1518/001872095779049543), 1995.
- Masicampo and Baumeister, [plan making and unfinished goals](https://pubmed.ncbi.nlm.nih.gov/21688924/), 2011.
- Hullman and Diakopoulos, [framing effects in narrative visualization](https://doi.org/10.1109/TVCG.2011.255), 2011.

### 15.3 Later visual option

- A2UI project, [declarative agent-generated UI and project status](https://github.com/a2ui-project/a2ui).
- A2UI project, [trusted component catalogs](https://a2ui.org/guides/defining-your-own-catalog/).
