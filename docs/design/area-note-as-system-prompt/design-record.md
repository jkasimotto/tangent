# The Area note as system prompt: design record

Date: 2026-08-27. Status: proposed, waits for Julian's word on the four decisions in section 8.

This record follows `../agent-shell-operating-vision/design-record.md` (D1, D4, D11, D16, D20) and the brain prompt draft that reads every main note on the Area route. It does not repeat them.

Facts are marked Observed, Decision, Assumption, or Unknown. Line numbers refer to the working tree on 2026-08-27. Vault paths are relative to `~/.tangent/trees`.

## 1. Problem contract

### Julian's words

> I want the area note to be like a system prompt. So repositories, branches, commands, things it should know every time, what skills are available etc. We probably need some more design about how to keep the area note clean and where information should actually go.

> Each area needs a main note. They need to read the note from each of those [Areas on the route to the root] for upwards context.

> Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents.

### The root problem

The brain prompt is now short. It tells the brain to read every main note from the root to its Area (D11). The note is the standing context. Today the notes are not fit for that job:

1. The biggest note is 263 lines. 138 of those lines are Goal links and 33 are appended ideas. A brain reads all of it every time.
2. Six Areas have no note at all. A brain on those Areas has no standing context.
3. `Current` holds dated narrative that nobody rewrites. `Knowledge` holds how-to procedures that belong in a skill file.
4. Nothing says what an ancestor note carries for the Areas under it. Julian's own comments in the notes ask where a fact goes.
5. The README rules for a clean note exist. The commit history shows they are not obeyed: 148 `add` commits against 12 `update` commits on one note.

### Constraints

- Keep the section names that exist. No new terms.
- The machine-read lines keep their shape: `Resources` lines, the `tangent.environment.v1` block, the `Goals` links, the `Idea:` lines, skill frontmatter.
- Rules an agent obeys when it edits come before machinery. One cheap read-only signal in the UI is allowed.
- Do not write code in this design. Do not edit vault files.

### Non-goals

- A schema, a linter, or a database for notes.
- Automatic pruning that rewrites prose.
- Changing the Goal file format or the brain prompt beyond one sentence.

### Success conditions

1. A new Area's main note fits on one screen and a brain can act from it without other reading.
2. Every standing fact has one home and the rule names it in one line.
3. A note stays under 100 lines after months of agent edits, and the UI shows when it does not.
4. The brain prompt can list the route notes and their skills without truncation budgets.

## 2. Current system

### 2.1 Survey of the main notes

Observed. The vault has 35 Areas after `.claude`, `.pi`, and `.obsidian` folders are excluded. 29 have a main note. 6 have none: `neara/essential`, `neara/hedno`, `neara/pyth`, `neara/portland/standards`, `otto/finance`, `otto/finance/reviews`. Each of the six holds only `.gitkeep`.

Observed. All 29 notes carry the six README sections: Purpose, Current, Knowledge, Ideas and open questions, Resources, plus `## Goals` in 27. `Road to done` survives in 8 notes. `Development environment` exists in 5 (`neara`, `neara/pgande`, `neara/portland`, `otto`, `otto/tangent`). Two `type: project` notes carry Objectives, Milestones, and Road to finish.

Observed. Sizes, in lines and words:

| Note | Lines | Words | Goal links | Ideas lines | Knowledge words |
|---|---|---|---|---|---|
| `otto/tangent/tangent.md` | 263 | 2974 | 135 | 33 | 779 |
| `neara/neara.md` | 125 | 379 | 64 | 0 | 170 |
| `neara/pgande/pgande.md` | 79 | 308 | 2 | 1 | 36 |
| `otto/dnd/dnd.md` | 65 | 312 | 24 | 8 | 0 |
| `neara/hackathon/live-edit/live-edit.md` | 55 | 586 | 24 | 0 | 204 |
| 18 leaf notes | 20 to 35 | 25 to 60 | 1 to 9 | 0 | 0 |

Observed. Eighteen notes are the empty template plus a Goal list. Their Purpose, Current, and Knowledge sections are blank. Example, `neara/pgande/autodesign/autodesign.md`: 26 lines, 37 words, seven Goal links, every prose section empty, and no Resources line.

### 2.2 Three representative notes

**Clean: `neara/pgande/standards/standards.md` (59 lines).** Purpose is one sentence. Knowledge is four paths and one paragraph that says what the paths are. Resources has `- Repository: ~/Projects/delivery` and `- Branch: otto-standards`. Twenty-two Goal links follow. This note works as a system prompt today, except for the Goal list.

**Bloated: `otto/tangent/tangent.md` (263 lines).** Line 14 to 16: `Current` is one sentence last changed on 2026-08-14, thirteen days ago. Lines 33 to 59: Knowledge holds two facts and 22 "Decisions and principles" bullets, up to 80 words each. Lines 61 to 96: 33 `- Idea:` lines. Fifteen carry a date. Most are bug reports ("Pipeline step marked stopped 240 ms after start...", "A brain in a long working turn is deaf to Julian"). Lines 97 to 104: Resources holds the repository and four Document links. Lines 105 to 242: 135 Goal links, done and open alike. Lines 243 to 263: the environment block.

Observed. The note grew from 39 lines on 2026-08-09 to 263 on 2026-08-27. Commit verbs on the file: 148 `add`, 41 `note`, 12 `update`. The README's durability test arrived on 2026-08-10 in a commit named "prune tangent note". No later prune exists.

**Missing: `neara/hedno`, `neara/pyth`.** Both are named as children in `neara/neara.md` line 9. Neither has a note. A brain started on them gets nothing but the root note.

### 2.3 How each section is used in practice

Observed, section by section:

- **Purpose.** One line or empty. `neara/neara.md` uses it as a child index. `otto/tangent` uses it for two paragraphs of product vision.
- **Current.** Text in 9 of 29 notes. `live-edit.md` lines 12 to 16 hold three paragraphs of dated progress, 240 words, last changed 2026-08-16. Nobody rewrote it after the work moved on.
- **Goals.** Written by the server at `server.mjs:1312` when a Goal is created. Read at `server.mjs:735-747` for order. Nothing removes a link when the Goal is done. This section is the main growth source.
- **Knowledge.** Three kinds mixed together. Path facts (`standards.md`). How-to procedures (`neara.md` lines 15 to 28: the `plz deploy-tool` recipe, and `pgande.md` lines 24 to 26: the localhost 7500 proxy). Decision lists (`tangent.md` lines 36 to 59).
- **Ideas and open questions.** Appended by `saveWorkIdea` at `server.mjs:1382-1393` as `- Idea: <one line>`. Read by `ideasFromNote` at `server.mjs:1345`. Nothing removes a line. `otto/dnd/dnd.md` uses the section well: eight deferred decisions, each with the reason.
- **Resources.** Machine lines in 8 notes. Design Document links in `tangent.md` and `embedded-js.md`. Two lines that do not parse in `pgande.md`: `- Repository \`$POLEZ\` — dart` (no colon, a shell variable). A legacy `- Agent:` line and a repo skill path in `speedrun.md`.

### 2.4 Julian's comments inside the notes

Observed. `pgande.md` carries four `%% %%` comments and `neara.md` one. They are the clearest statement of the problem:

- `pgande.md` line 44: "Where is the following stored? My usual layout for pgande related stuff... Where are the commands on how to check the release on an env? That could be in neara maybe because it's more relevant there."
- `neara.md` line 15: on the `plz deploy-tool` recipe: "Would a pgande agent ever actually see this? Maybe. This should probably just be a skill in polez anyway?"
- `pgande.md` line 30, on Resources: "This is much better than the tangent note."

### 2.5 What the machine reads

Observed. These are the only lines Tangent parses in a main note:

| Line or block | Reader | Writer |
|---|---|---|
| `- Repository:`, `- Worktree:`, `- Branch:` under `## Resources` | `area-resources.mjs:14-50`. Dash optional, backticks tolerated, a trailing ` (note)` ignored. Nearest ancestor wins, `:87-100`. A vault-folder binding does not inherit, `:113-125`. | Humans and agents. `unboundAreaMessage` at `:134-138` prints the exact line to add. |
| `[[goal-...]]` links under `## Goals` (and legacy `Road to done`) | `server.mjs:735-747`, order only | `server.mjs:1312` on Goal create |
| `- Idea:` lines under `## Ideas and open questions` | `server.mjs:1345`, `area show` | `server.mjs:1382-1393`, `tangent idea add` |
| ```` ```tangent.environment.v1 ```` fence | `launch-environment.mjs:51-61`, inherited at `:240-259` | The UI save at `:183-201`, which appends a `## Development environment` section when absent |
| First line of `## Purpose`, first paragraph of `## Current` | The Area map, `server.mjs:958-959` | Humans and agents |
| `name:` and `description:` in `skill-<slug>.md` frontmatter | The brain prompt (D20, not built) | Humans and agents |

Observed. The brain prompt today clips sections: Purpose 1000, Current 1000, Knowledge 1600 characters on the exact Area, Purpose 400 and Knowledge 600 on ancestors (`area-brain-domain.mjs:38-41`). The new draft removes the clip and tells the brain to read every note. The note's size then costs brain context directly. `tangent.md` at 2974 words is about 4000 tokens, and 3000 of those are Goal links and ideas.

Observed. The server creates a new note from a template at `area-operations.mjs:68` with Purpose, Current, Goals, Knowledge, Ideas and open questions, Resources. The template has no `Road to done`.

### 2.6 README rules and whether they hold

Observed. `README.md` gives five rules. The note describes the present (line 17). Each item has one home (line 22). Edit in place and remove completed items after harvest (line 24). Knowledge passes the durability test and narrative goes to git (line 25). A large topic moves to a Document beside the note (line 26).

Observed. The rules are not obeyed on the two notes that matter most:

- `live-edit.md` Current describes 2026-08-15 and 2026-08-16. Not the present.
- `tangent.md` Ideas has 33 lines, 15 with dates, most of them resolved bug reports. Not one home, not edited in place.
- `tangent.md` Knowledge has 22 decision bullets with narrative ("Voice used to record on a plain ⌥...").
- 138 done and open Goal links stay in the list. Completed items are not removed.

Proposed generalization. The rules fail where a machine appends and no rule tells anyone to remove. Goals and Ideas grow by command. Nothing shrinks them. Prose sections fail more slowly because agents write "add" commits and nobody writes "update" commits.

## 3. Internal precedent

Observed. The instruction files this machine already uses are small indexes with links:

- `~/.agents/AGENTS.md`: 50 lines. One paragraph of what Tangent is, then one bullet per command. It links the README for vault rules instead of repeating them.
- `/Users/julianotto/Projects/otto-tangent/CLAUDE.md`: 153 lines. Layout table, commands, package list, then "Architecture docs:" as a list of paths. Product direction is a paragraph with a link to the spec.
- `packages/agent-shell/CLAUDE.md`: 16 lines. One "Purpose:" line, five "Local rules" bullets, and "Read next:" with three paths.
- `docs/agent/*.md`: six files of 8 to 16 lines each.
- Skills in `~/.claude/skills/`: the `SKILL.md` body is 65 to 339 lines, and the long ones carry a `references/` folder. Only `name` and `description` are read up front.

Observed. The pattern is the same everywhere: a short standing file, one line per fact, and links to the long material.

## 4. External precedent

Observed, from the Claude Code memory and skills documentation (`code.claude.com/docs/en/memory`, `/skills`, read 2026-08-27):

- "Keep it to facts Claude should hold in every session: build commands, conventions, project layout, 'always do X' rules. If an entry is a multi-step procedure or only matters for one part of the codebase, move it to a skill."
- "Size: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."
- "Create a skill when you keep pasting the same instructions, checklist, or multi-step procedure into chat, or when a section of CLAUDE.md has grown into a procedure rather than a fact. Unlike CLAUDE.md content, a skill's body loads only when it's used."
- Skill `description`: "What the skill does and when to use it." The listing truncates at 1,536 characters.
- Files in parent directories load first. A subdirectory's file adds to them. Nothing overrides.
- Auto memory keeps `MEMORY.md` as an index of one line per memory, capped at 200 lines, with detail in topic files. The tool reminds the model to shorten it near the cap.

Why the analogy holds. A main note on the route is the same object as a `CLAUDE.md` on a directory path. Both load every time, root to leaf, for a model that cannot ask questions. A `skill-<slug>.md` is the same object as a skill: named up front, read on demand. The Area route already inherits like the directory hierarchy.

## 5. Lenses

Selected: Architecture, types, and data (ownership and invariants of note content). UI/UX (one read-only signal). No API, migration, or operations lens: nothing crosses a process boundary and no stored format changes.

### Architecture, types, and data

Ownership per section, from the survey:

| Section | Owner of writes | Life | Reader that must not break |
|---|---|---|---|
| Purpose | Julian, brain | Standing | Area map first line |
| Resources | Julian, brain | Standing | Resource parser |
| Knowledge | Brain, workers through the brain | Standing | None |
| Development environment | The UI only | Standing | Environment parser |
| Current | Brain | Weekly | Area map first paragraph |
| Goals | The server | Per Goal | Order reader |
| Ideas and open questions | `tangent idea add`, Julian, brain | Until triaged | `ideasFromNote` |

Invariant to keep: the machine-read lines keep their exact shape. Everything else is free prose. No new parser.

### UI/UX

The Area header in Work already carries a small mark for brain questions (D15). One more read-only line beside the note's name is the whole surface: note length and the age of `Current`. Both come from the file and git without new records. The design skill's "instant recognition" rule applies: a number in dim text at a normal size, a warning color past the guide.

## 6. Candidate designs

### C1. Rules only, sections unchanged

Add one rule per section to the README and one sentence to the brain prompt. No code. Cheapest. Weakness: the two growth sources are machine appends, and no rule shrinks them. The survey shows prose rules alone did not hold for 18 days.

### C2. Rules plus two small machine changes

C1, plus two changes. The server removes a Goal link from `## Goals` when the Goal is done or dropped. The UI shows note length and `Current` age. No new parser, no new file. Weakness: two code changes, and Julian loses the done list in the note (it stays in `tangent goal list` and git).

### C3. Split the note into two files

A standing file (`<area>.md`) and a state file (`current-<area>.md` or the plan Document). The brain reads only the first. Weakness: a new term, two files to keep in step, and the Area map reads `Current` from the main note today. Julian rejected new concepts on 2026-08-27.

### C4. A `tangent area check` command

A command that prints the rule violations per note: length, stale Current, unparsed Resources lines, Ideas over the cap. Weakness: machinery before anyone tried the rule. Kept in reserve.

Decision: C2. C1 is inside it. C3 invents a term. C4 waits for evidence that C2 fails.

## 7. Evidence and counterexamples

- Counterexample to "Knowledge is standing facts": `neara.md` Knowledge is a recipe with a shell command and three sub-commands. Julian's own comment asks if it is a skill. The rule needs the sentence "a procedure is a skill file".
- Counterexample to "Resources is places": `tangent.md` Resources holds four Document links, and `speedrun.md` holds a dashboard folder and a skill path. Links to standing Documents are places too. The rule allows them and keeps the three machine lines at the top.
- Counterexample to "one Repository per Area": `pgande.md` names two repositories, polez and delivery, and the parser reads only the first that matches. D1 already made this choice. The design keeps it and names the fix: the second repository is a `- Path:` free line or a child Area.
- Counterexample to "Ideas are Julian's thoughts": 30 of the 33 ideas in `tangent.md` were written by brains as bug reports. The rule must say where a bug report goes (a Goal, or nothing).
- Counterexample to "Current is rewritten weekly": `otto/dnd/dnd.md` Current is one sentence that names two Goal links and is still true. A Current that names Goals ages better than one that tells a story.
- Failed hypothesis: "the notes are bloated because agents write too much prose". The measurement says otherwise. Prose is 40 to 60 lines even in the worst note. The machine lists are 170 lines.

## 8. Decisions

Julian's decision rights are marked (Julian decides).

**D1. The sections stay. Each gets a one-line rule.** Order in the file: Purpose, Resources, Knowledge, Current, Goals, Ideas and open questions, Development environment. Standing sections first so a reader stops early.

| Section | The rule |
|---|---|
| Purpose | One to three lines. What this Area is and what done looks like. |
| Resources | Where the work is. The three machine lines first, then paths, branches, URLs, environments, and links to standing Documents. One fact per line. |
| Knowledge | What an agent needs every time it works here. Commands, conventions, gotchas, decisions with their reason. One line each. A procedure is a `skill-<slug>.md`. A large topic is a Document with a link here. |
| Current | What is in motion now, in present tense, at most five lines, no dates. Rewrite it, never append. Name Goals with links instead of telling the story. Empty is fine. |
| Goals | Machine-written links to open Goals, in order. Do not edit by hand except to reorder. |
| Ideas and open questions | Thoughts and questions that are not yet a Goal, one line each, at most ten. A bug is a Goal, not an idea. |
| Development environment | The UI writes this block. Leave it. |

Decisive evidence: section 2.3 and Julian's comments in 2.4. Commands go in Knowledge, not Resources, because Julian's sentence pairs "commands" with "things it should know every time" and Resources already means "where the work happens" in the README and the parser. (Julian decides: he named "repositories, branches, commands" in one breath. If he wants commands under Resources, only the rule text changes. The word "should" in the quoted docs is theirs.)

**D2. Standing, current, and history live in three places.**

- Standing, read every time: Purpose, Resources, Knowledge, Development environment, and the `skill-` and `process-` files beside the note.
- Current, changes weekly: Current, Goals, Ideas. The Goal files hold each Goal's own State.
- History, never in the note: dated progress, what a worker did, how a bug was fixed, why an old decision was replaced. The commit message and the Goal file's State hold these. The plan Document, when an Area has one, holds the brain's working memory and is linked from Resources.

Decisive evidence: README lines 24 to 25 already say this. The design adds the sentence "a worker's result goes in the Goal file, and at most one line reaches Knowledge".

**D3. A fact lives at the highest Area where it is true for every Area under it, and no higher.** A child never repeats an ancestor's line. A child adds a line or overrides a Resources line, nearest wins, as the parser already does. What a root note carries: the shared repository, the branch convention, the commands every child uses, the skills every child uses, and the list of children with one phrase each. What it must not carry: any Goal, any Current, any fact true for one child only.

This reconciles the README's "deepest node wins" (line 11) with Julian's pgande comment: the release-check command is true for every Neara Area, so it lives in `neara.md`, as a skill.

**D4. The machine reads exactly these lines and nothing else.** The table in section 2.5 is the contract. Paths in Resources lines are absolute or start with `~`. Shell variables such as `$POLEZ` do not parse. One Repository line per note. A skill's frontmatter has `name:` and `description:`, and the brain prompt lists both. The rest of the note is free prose that no code parses. No new parser is added by this design.

**D5. Hygiene is four edit rules, one machine change, and one signal.**

Edit rules, added to the README and, in one sentence, to the brain prompt:

1. Rewrite, do not append. Every edit to Current, Knowledge, or Ideas replaces text.
2. Harvest, then delete. When a Goal finishes, write at most one Knowledge line, then let its link go.
3. Size guide: Purpose 3 lines, Current 5, Knowledge 30, Ideas 10, Resources 15. The whole note under 100 lines. When a section passes its guide, move something out before adding.
4. No dates, no conversation ids, no bug reports in the note. A date belongs in git. A bug is a Goal.

Machine change: the server removes a Goal's link from `## Goals` when the Goal becomes done or dropped, in the same write that sets the status. Open Goals stay in their order. (Julian decides: the done links are the only record of finished work inside the note. `tangent goal list` and git keep them.)

Signal: beside the note name in Work and on the Area page, one dim line: `<n> lines · Current <d> days old`. Warning color past 100 lines or past 14 days. Read from the file and `git log -1` on the Current section. No stored record.

`tangent area check` (C4) is not built. Revisit if three notes pass 100 lines a month after the rules land.

**D6. Missing notes are created from the template.** When a brain starts or a Goal is created on an Area with no main note, the server writes the template of D7 and commits it. The brain fills Purpose and Resources as its first act. Assumption: `area-operations.mjs:68` is the one template writer and the create path can reuse it. Not verified.

**D7. The template for a new Area's main note.**

```markdown
---
type: area
status: active
---

# <Name>

## Purpose

<What this Area is and what done looks like. One to three lines.>

## Resources

- Repository: <absolute path or ~/path>
- Branch: <name>

## Knowledge

- <One fact an agent needs every time. Commands, conventions, gotchas.>

## Current

## Goals

## Ideas and open questions
```

Twenty-two lines. `Worktree:` is added when one exists. The environment block arrives when Julian sets a default in the UI. Skills are files beside the note, not lines in it.

## 9. Rejected alternatives

- **A frontmatter field per resource** (`repository:`, `branch:` in YAML). Rejected: the README allows five frontmatter keys and no others, three parsers already agree on the Resources lines, and Julian said "notes we pass around", not records.
- **A separate state file** (C3). Rejected: a new term and a second file to keep in step. The plan Document already exists for a brain's working memory.
- **Clipping sections in the brain prompt** (today's budgets). Rejected: a clip hides the tail of Knowledge from the brain and hides the bloat from Julian. The size guide and the signal make the problem visible instead.
- **Automatic pruning of Ideas or Knowledge by age.** Rejected: nothing auto-edits prose in this vault. Git is the archive and the brain is the editor.
- **`tangent area check`** (C4). Deferred, not rejected. The strongest alternative. It loses because it is machinery before the rule has had one month.

## 10. Risks, assumptions, and unknowns

- Assumption: brains obey a size guide when the prompt names it. Auto memory in Claude Code relies on the same mechanism with a reminder near the cap. The signal in the UI is the reminder here.
- Assumption: removing done Goal links breaks no reader. `areaGoalOrder` reads open and done alike for order only, and `readAreaGoals` lists files, not links. Not tested.
- Risk: Julian reads `## Goals` as a progress record. The done rows still show in Work and in `tangent goal list`.
- Unknown: whether the Area map's use of `Current` (first paragraph) needs a fallback when Current is empty. Today 20 notes have an empty Current and the map works.
- Unknown: how many `pgande`-style two-repository Areas exist beyond the one found. The survey found one.
- Condition for reconsideration: if three notes pass 100 lines a month after the rules land, build C4.

## 11. Sources

- Vault: `~/.tangent/trees/README.md` lines 15 to 27 (node notes), 60 to 78 (processes and skills). Notes named in section 2.
- Brain prompt draft: scratchpad `brain-prompt.md`.
- Prior design: `../agent-shell-operating-vision/design-record.md` D1 to D4, D11, D16, D20. `vision.md` and `user-intent.md` beside it.
- Code: `packages/agent-shell/app/area-resources.mjs` (whole file), `launch-environment.mjs:51-61, 183-201, 240-259`, `area-brain-domain.mjs:38-41`, `area-operations.mjs:68`, `server.mjs:735-747, 958-959, 1312, 1345-1393, 6405-6420`.
- Instruction files: `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, `/Users/julianotto/Projects/otto-tangent/CLAUDE.md`, `packages/agent-shell/CLAUDE.md`, `docs/agent/*.md`.
- External: `https://code.claude.com/docs/en/memory`, `https://code.claude.com/docs/en/skills`, read 2026-08-27.
- Git: `git log` on `otto/tangent/tangent.md` (verbs, line counts per date), `git log -L` on the Current sections of `live-edit.md` and `tangent.md`.
