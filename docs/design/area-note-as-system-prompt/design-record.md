# The Area note as system prompt: design record

Date: 2026-08-27, revised twice the same evening after Julian's answers (section 1). Status: agreed. One open point on the environment block (section 11).

This record follows `../agent-shell-operating-vision/design-record.md` (D1, D4, D11, D16, D20) and its `evidence/area-skills.md`. It does not repeat them.

Facts are marked Observed, Decision, Assumption, or Unknown. Line numbers refer to the working tree on 2026-08-27. Vault paths are relative to `~/.tangent/trees`.

## 1. Julian's words

First framing:

> I want the area note to be like a system prompt. So repositories, branches, commands, things it should know every time, what skills are available etc. We probably need some more design about how to keep the area note clean and where information should actually go.

> Each area needs a main note. They need to read the note from each of those [Areas on the route to the root] for upwards context.

His answers to the first draft of this record:

> resources (links branches repos commands etc) go in knowledge. We basically treat each area note as an AGENTS.md in fact maybe we just do that. That so simple. We have one AGENTS.md and one CLAUDE.md symlinked to that per area. Then brains that get launched dont need a message sent they have the system prompt from that. and the root .tangent one tells how to be a good brain. its not one repo per area. thats why its just freeform text for the brain to read.

On the Goal list in the note:

> It better not be in the AGENTS.md one. There's no need for it there. Goals should just be goal-slug files in the area repo.

The operating philosophy: "Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents."

## 2. Problem contract

### The root problem

A brain opens in its Area folder in the vault (D4). Its standing context is the main note of its Area and of every Area above it. Today the notes are not fit for that job:

1. The biggest note is 263 lines. 138 of those lines are Goal links and 33 are appended ideas. A brain reads all of it every time.
2. Six Areas have no note at all.
3. `Current` holds dated narrative that nobody rewrites. `Knowledge` holds how-to procedures that belong in a skill file.
4. Nothing says what an ancestor note carries for the Areas under it. Julian's own comments in the notes ask where a fact goes.
5. The README rules for a clean note exist. The commit history shows they are not obeyed: 148 `add` commits against 12 `update` commits on one note.
6. Tangent builds a brain prompt from the notes with clipping budgets. The harnesses already do this job natively for `AGENTS.md` and `CLAUDE.md`.

### Constraints

- Keep the section names that exist. No new terms.
- Tangent never writes into an Area note. The one open point is the `tangent.environment.v1` block the UI writes today (section 11).
- Rules an agent obeys when it edits come before machinery. Two small mechanical pieces are allowed: a symlink sweep and a template write.
- Do not write code in this design. Do not edit vault files.

### Non-goals

- A schema, a linter, or a database for notes.
- Automatic pruning that rewrites prose.
- A generated brain prompt. The harness reads the notes itself.

### Success conditions

1. A brain started in `~/.tangent/trees/<area>` sees the root `AGENTS.md` and every main note on its route, with no Tangent prompt.
2. A new Area's main note fits on one screen and a brain can act from it without other reading.
3. Every standing fact has one home and the rule names it in one line.
4. A note stays under 100 lines after months of agent edits, and the UI shows when it does not.

## 3. Current system

### 3.1 Survey of the main notes

Observed. The vault has 35 Areas after `.claude`, `.pi`, and `.obsidian` folders are excluded. 29 have a main note. 6 have none: `neara/essential`, `neara/hedno`, `neara/pyth`, `neara/portland/standards`, `otto/finance`, `otto/finance/reviews`. Each of the six holds only `.gitkeep`.

Observed. All 29 notes carry the six README sections: Purpose, Current, Knowledge, Ideas and open questions, Resources, plus `## Goals` in 27. `Road to done` survives in 8 notes. `Development environment` exists in 5 (`neara`, `neara/pgande`, `neara/portland`, `otto`, `otto/tangent`).

Observed. Sizes, in lines and words:

| Note | Lines | Words | Goal links | Ideas lines | Knowledge words |
|---|---|---|---|---|---|
| `otto/tangent/tangent.md` | 263 | 2974 | 135 | 33 | 779 |
| `neara/neara.md` | 125 | 379 | 64 | 0 | 170 |
| `neara/pgande/pgande.md` | 79 | 308 | 2 | 1 | 36 |
| `otto/dnd/dnd.md` | 65 | 312 | 24 | 8 | 0 |
| `neara/hackathon/live-edit/live-edit.md` | 55 | 586 | 24 | 0 | 204 |
| 18 leaf notes | 20 to 35 | 25 to 60 | 1 to 9 | 0 | 0 |

Observed. Eighteen notes are the empty template plus a Goal list. Example, `neara/pgande/autodesign/autodesign.md`: 26 lines, 37 words, seven Goal links, every prose section empty.

### 3.2 Three representative notes

**Clean: `neara/pgande/standards/standards.md` (59 lines).** Purpose is one sentence. Knowledge is four paths and one paragraph that says what the paths are. Resources has the repository and the branch. Twenty-two Goal links follow. This note works as a system prompt today, except for the Goal list.

**Bloated: `otto/tangent/tangent.md` (263 lines).** Lines 14 to 16: `Current` is one sentence last changed on 2026-08-14. Lines 33 to 59: Knowledge holds two facts and 22 "Decisions and principles" bullets, up to 80 words each. Lines 61 to 96: 33 `- Idea:` lines, 15 with a date, most of them bug reports. Lines 105 to 242: 135 Goal links, done and open alike. Lines 243 to 263: the environment block.

Observed. The note grew from 39 lines on 2026-08-09 to 263 on 2026-08-27. The README's durability test arrived on 2026-08-10 in a commit named "prune tangent note". No later prune exists.

**Missing: `neara/hedno`, `neara/pyth`.** Both are named as children in `neara/neara.md` line 9. Neither has a note.

### 3.3 How each section is used in practice

- **Purpose.** One line or empty. `neara/neara.md` uses it as a child index.
- **Current.** Text in 9 of 29 notes. `live-edit.md` lines 12 to 16 hold three paragraphs of dated progress, last changed 2026-08-16.
- **Goals.** Written by the server at `server.mjs:1312` when a Goal is created. Read at `server.mjs:735-747` for order. Nothing removes a link when the Goal is done. The Goal files themselves are listed by `readAreaGoals`, which reads the folder, not the note.
- **Knowledge.** Three kinds mixed. Path facts (`standards.md`). How-to procedures (`neara.md` lines 15 to 28, `pgande.md` lines 24 to 26). Decision lists (`tangent.md` lines 36 to 59).
- **Ideas and open questions.** Appended by `saveWorkIdea` at `server.mjs:1382-1393`. Nothing removes a line. `otto/dnd/dnd.md` uses the section well: eight deferred decisions, each with the reason.
- **Resources.** Machine lines in 8 notes. Document links in two. Two lines that do not parse in `pgande.md`: `- Repository \`$POLEZ\` — dart`. `pgande.md` names two repositories, polez and delivery, and the parser reads one.

### 3.4 Julian's comments inside the notes

Observed. `pgande.md` line 44: "Where is the following stored? My usual layout for pgande related stuff... Where are the commands on how to check the release on an env? That could be in neara maybe." `neara.md` line 15, on a `plz deploy-tool` recipe: "Would a pgande agent ever actually see this? This should probably just be a skill in polez anyway?"

### 3.5 What the machine reads

Observed. These are the lines Tangent parses in a main note today:

| Line or block | Reader | Writer |
|---|---|---|
| `- Repository:`, `- Worktree:`, `- Branch:` under `## Resources` | `area-resources.mjs:14-50`, nearest ancestor wins at `:87-100` | Humans and agents |
| `[[goal-...]]` links under `## Goals` | `server.mjs:735-747`, order only | `server.mjs:1312` on Goal create |
| `- Idea:` lines under `## Ideas and open questions` | `server.mjs:1345`, `area show` | `server.mjs:1382-1393` |
| ```` ```tangent.environment.v1 ```` fence | `launch-environment.mjs:51-61`, inherited at `:240-259` | The UI save at `:183-201` |
| First line of `## Purpose`, first paragraph of `## Current` | The Area map, `server.mjs:958-959` | Humans and agents |
| `name:` and `description:` in `skill-<slug>.md` frontmatter | `tangent area show` (D20, not built) | Humans and agents |

Observed. The brain prompt today clips sections: Purpose 1000, Current 1000, Knowledge 1600 characters on the exact Area, and Purpose 400, Knowledge 600 on ancestors (`area-brain-domain.mjs:38-41`). The server creates a new note from a template at `area-operations.mjs:68`.

### 3.6 How the harnesses read instruction files

Observed from the vendor documentation, cited in `../agent-shell-operating-vision/evidence/area-skills.md` section 2:

- Claude Code "loads `CLAUDE.md` and `CLAUDE.local.md` from your current working directory and every directory above it", concatenated root down. "Claude Code reads `CLAUDE.md`, not `AGENTS.md`." The docs offer `ln -s AGENTS.md CLAUDE.md`.
- Codex: "Starting at the project root (typically the Git root), Codex walks down to your current working directory", reading `AGENTS.md` in each folder. The total is capped by `project_doc_max_bytes`, 32 KiB by default.
- pi reads `AGENTS.md` from the parent directories walking up from cwd, then the current directory (pi README line 323).

Observed by test on 2026-08-27. A scratch git repository held `root.md`, `AGENTS.md -> root.md`, and `CLAUDE.md -> AGENTS.md`. A `leaf/` folder held the same pattern around `leaf.md`. Each harness started in `leaf/` and was asked for the secret words in its instruction files. `claude -p --model haiku`, `codex exec -s read-only`, and `pi -p` (node 22) each answered `PELICAN, WALRUS`, one word from each note. Symlinked chains work in all three, root and leaf both.

Observed. The vault is one git repository at `~/.tangent/trees`, so the Codex walk starts at the vault root. `~/.codex/config.toml` trusts the vault. The vault tracks no symlinks today, and no `AGENTS.md` or `CLAUDE.md` exists under it.

Unknown: agy, opencode, and the gateway harnesses were not tested. The evidence file records that all four harnesses in use share the context-file lane.

### 3.7 README rules and whether they hold

Observed. `README.md` gives five rules. The note describes the present (line 17). Each item has one home (line 22). Edit in place and remove completed items after harvest (line 24). Knowledge passes the durability test and narrative goes to git (line 25). A large topic moves to a Document beside the note (line 26).

Observed. The rules are not obeyed on the two notes that matter most. `live-edit.md` Current describes 2026-08-16. `tangent.md` Ideas has 33 lines, most of them resolved bug reports. 138 Goal links stay in one list.

Proposed generalization. The rules fail where a machine appends and no rule tells anyone to remove. Goals and Ideas grow by command. Nothing shrinks them.

## 4. Internal precedent

Observed. The instruction files this machine already uses are small indexes with links:

- `~/.agents/AGENTS.md`: 50 lines. One paragraph of what Tangent is, then one bullet per command. It links the README for vault rules instead of repeating them.
- `/Users/julianotto/Projects/otto-tangent/CLAUDE.md`: 153 lines. Layout table, commands, package list, then "Architecture docs:" as a list of paths.
- `packages/agent-shell/CLAUDE.md`: 16 lines. One "Purpose:" line, five "Local rules" bullets, "Read next:" with three paths.
- Every harness home already symlinks its instruction file to `~/.agents/AGENTS.md` (`~/.codex/AGENTS.md`, `~/.pi/agent/AGENTS.md`, `~/.claude-otto/CLAUDE.md` with `@~/.agents/AGENTS.md`).

The pattern is the same everywhere. A short standing file, one line per fact, links to the long material. One real file and symlinks to it.

## 5. External precedent

Observed, from the Claude Code memory and skills documentation (`code.claude.com/docs/en/memory`, `/skills`, read 2026-08-27):

- "Keep it to facts Claude should hold in every session: build commands, conventions, project layout, 'always do X' rules. If an entry is a multi-step procedure or only matters for one part of the codebase, move it to a skill."
- "Size: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."
- "A skill's body loads only when it's used." Skill `description`: "What the skill does and when to use it."
- Auto memory keeps `MEMORY.md` as an index of one line per memory, capped at 200 lines. The tool reminds the model to shorten it near the cap.

Why the analogy holds. Julian's answer makes it literal. The main note is the `AGENTS.md` of its folder. The harness loads it every turn, root to leaf, for a model that cannot ask questions. A `skill-<slug>.md` is the same object as a skill: named up front, read on demand.

## 6. Lenses

Selected: Architecture, types, and data (ownership of note content, the symlink invariant). UI/UX (one read-only signal). Migration (the six missing notes and the `Resources` sections that exist).

### Architecture, types, and data

Ownership per section:

| Section | Owner of writes | Life | Reader that must not break |
|---|---|---|---|
| Purpose | Julian, brain | Standing | Area map first line |
| Knowledge | Julian, brain, workers through the brain | Standing | None. The Resources parser is optional. |
| Development environment | The UI only | Standing | Environment parser |
| Current | Brain | Weekly | Area map first paragraph |
| Ideas and open questions | Julian, brain | Until triaged | None |

Invariant: Tangent reads Area notes and never writes them. The server's two writers today, `server.mjs:1312` (Goal links) and `server.mjs:1382-1393` (ideas), go. Second invariant: `<area>/AGENTS.md` is a relative symlink to `<dirname>.md`, and `<area>/CLAUDE.md` is a relative symlink to `AGENTS.md`. The vault root has a real `AGENTS.md` and `CLAUDE.md -> AGENTS.md`. A real file at either name is never overwritten. Wikilinks and the Document index keep pointing at `<dirname>.md`. Tangent's walkers skip nothing new: the two names are files, not folders.

Trade-off, stated plainly. With Resources folded into Knowledge, nothing machine-checks the folder before a worker starts. The brain reads the path from Knowledge and passes `--path`. A wrong path fails at the worker start, not before. The `- Repository:` parser stays as an optional shortcut for an Area that wants inherited defaults.

### UI/UX

One dim line beside the note name in Work and on the Area page: note length and the age of `Current`. Both come from the file and git without new records. Warning color past the guide.

### Migration

- Six Areas without a note get the template (D8).
- 29 notes have a `## Resources` section. The brain moves its lines under Knowledge the next time it edits the note. The parser tolerates both places for one release, so nothing breaks the day the rule lands.
- The symlink sweep runs once at server start and again on Area create.

## 7. Candidate designs

### C1. Tangent generates the brain prompt from the notes

Today's model, with the clipping budgets removed. Tangent reads the route and inlines the notes. Weakness: a second reader of the same files, budgets, and a prompt the harness then appends its own context files to. Julian: "brains that get launched dont need a message sent".

### C2. The note is the harness instruction file, by symlink

Each Area folder gets `AGENTS.md -> <dirname>.md` and `CLAUDE.md -> AGENTS.md`. The vault root gets a real `AGENTS.md` that says how to be a brain, with `CLAUDE.md -> AGENTS.md`. The harness reads the chain itself. Tangent generates nothing. Verified in all three harnesses (3.6). Weakness: two symlinks per Area in git, and a third harness family untested.

### C3. Rename the main note to `AGENTS.md`

No symlinks. Weakness: wikilinks resolve by file name, the Document index keys on `<dirname>.md`, and Obsidian shows a folder of files all named the same. Julian rejected renames by implication: "one AGENTS.md and one CLAUDE.md symlinked to that".

### C4. `tangent area check`

A command that prints rule violations per note. Weakness: machinery before anyone tried the rule. Kept in reserve.

Decision: C2, with the hygiene rules of section 9. C1 is what Julian moved away from. C3 breaks links. C4 waits.

## 8. Evidence and counterexamples

- Counterexample to "Knowledge is standing facts": `neara.md` Knowledge is a recipe with a shell command. Julian's own comment asks if it is a skill. The rule needs the sentence "a procedure is a skill file".
- Counterexample to "one Repository per Area": `pgande.md` names two repositories. Julian: "its not one repo per area". Under Knowledge, both fit as free lines with what each is for.
- Counterexample to "Ideas are Julian's thoughts": 30 of the 33 ideas in `tangent.md` were written by brains as bug reports. The rule says where a bug report goes: a Goal, or nothing.
- Counterexample to "Current is rewritten weekly": `otto/dnd/dnd.md` Current names two Goal links and is still true. A Current that names Goals ages better than one that tells a story.
- Failed hypothesis: "the notes are bloated because agents write too much prose". Prose is 40 to 60 lines even in the worst note. The machine lists are 170 lines.
- Every note is now read on every turn. Codex caps the chain at 32 KiB. `tangent.md` alone is 17 KB. This strengthens the 100-line guide from a preference to a working limit.

## 9. Decisions

**D1. The main note is the Area's `AGENTS.md` (Julian).** `<area>/AGENTS.md` is a relative symlink to `<dirname>.md`. `<area>/CLAUDE.md` is a relative symlink to `AGENTS.md`. The vault root holds a real `AGENTS.md`. It tells a brain what Tangent is, its commands, how work flows, and the edit rules (draft in the scratchpad `vault-root-AGENTS.md`). `CLAUDE.md` at the root links to it. A brain opens in its Area folder and the harness reads root, then every note on the route, then the Area's own note. Tangent sends no brain prompt. Julian's first message is still the founding message (vision D8).

**D2. No `## Resources` section (Julian).** Repositories, worktrees, branches, links, commands, environments, and conventions are free-form bullets under `## Knowledge`. One fact per line, with what it is for. The brain takes the folder from Knowledge and passes `--path` on `tangent goal create`. The `- Repository:` parser in `area-resources.mjs` stays as an optional shortcut and reads the line wherever it sits. An Area with two repositories lists both. The trade-off: nothing checks the folder before the start.

**D3. The sections and their rules.** Order: Purpose, Knowledge, Current, Ideas and open questions, Development environment. Standing sections first so a reader stops early.

| Section | The rule |
|---|---|
| Purpose | One to three lines. What this Area is and what done looks like. |
| Knowledge | What an agent needs every time it works here. Repositories, branches, commands, URLs, conventions, gotchas, decisions with their reason. One line each. A procedure is a `skill-<slug>.md`. A large topic is a Document with a link here. |
| Current | What is in motion now, in present tense, at most five lines, no dates. Rewrite, never append. Name Goals with links. Empty is fine. |
| Ideas and open questions | Thoughts and questions that are not yet a Goal, one line each, at most ten. Hand-written. `tangent idea add` goes to `ideas.md` instead. A bug is a Goal, not an idea. |
| Development environment | The UI writes this block. Leave it. |

**D4. Standing, current, and history live in three places.** Standing, read every turn: Purpose, Knowledge, Development environment, and the `skill-` and `process-` files beside the note. Current, changes weekly: Current, Ideas, and `ideas.md`. History, never in the note: dated progress, what a worker did, how a bug was fixed. The commit message and the Goal file's State hold these. A worker's result goes in the Goal file, and at most one line reaches Knowledge.

**D5. A fact lives at the highest Area where it is true for every Area under it.** Never higher. A child never repeats an ancestor's line. The harness concatenates the chain. A repeated line costs context twice. What a root note carries: the shared repository, the branch convention, the commands every child uses, and the list of children with one phrase each. What it must not carry: any Goal, any Current, any fact true for one child only. The release-check command is true for all of Neara, so it lives in `neara.md` as a skill.

**D6. Tangent never writes into an Area note (Julian).** The `## Goals` section goes entirely. A Goal is its `goal-<slug>.md` file in the Area folder and nothing else. No link list, no ordering from the note. Work and `tangent goal list` order Goals by status, then by creation time. `areaGoalOrder` (`server.mjs:735-747`) and the append at `server.mjs:1312` go. The `- Idea:` append (`server.mjs:1382-1393`) goes too. `tangent idea add` writes one line into `<area>/ideas.md`, a plain Document beside the note, and creates it when absent. The brain reads `ideas.md`, turns a line into a Goal or a Knowledge line, and deletes it. The note's own `Ideas and open questions` stays hand-written.

**D7. Hygiene is four edit rules and one signal.** In the README and, in one sentence each, in the root `AGENTS.md`:

1. Rewrite, do not append. Every edit to Current, Knowledge, or Ideas replaces text.
2. Harvest, then delete. When a Goal finishes, write at most one Knowledge line. When an `ideas.md` line becomes a Goal or a fact, delete the line.
3. Size guide: Purpose 3 lines, Knowledge 40, Current 5, Ideas 10. The whole note under 100 lines. When a section passes its guide, move something out before adding.
4. No dates, no conversation ids, no bug reports in the note. A date belongs in git. A bug is a Goal.

README changes: line 17 lists the sections as Purpose, Knowledge, Current, Ideas and open questions. Line 18 (Resources) goes. Line 21 (Road to done as the ordering source) becomes: Work orders Goals by status, then creation time. Line 23 (checkboxes under Road to done) goes. The Outcomes bullet on ordering ("Ordering has one home per outcome") loses the node-note half. A new line: `tangent idea add` writes to `<area>/ideas.md`. A new line: `AGENTS.md` and `CLAUDE.md` in an Area folder are symlinks to the main note, written by Tangent, never edited.

Signal: beside the note name in Work and on the Area page, one dim line: `<n> lines · Current <d> days old`. Warning color past 100 lines or past 14 days. `tangent area check` (C4) is not built. Revisit if three notes pass 100 lines a month after the rules land.

**D8. Two mechanical pieces.**

- The symlink sweep. At server start and on Area create, for every Area folder: if `AGENTS.md` is absent, write the relative symlink to `<dirname>.md`. If `CLAUDE.md` is absent, write the relative symlink to `AGENTS.md`. Never replace a real file or a symlink that points elsewhere. Report what it wrote. Commit through `tangent vault commit`. Idempotent: a second run writes nothing.
- The missing note. If a brain starts or a Goal is created on an Area with no main note, the server writes the template of D9. Then it commits it. The brain fills Purpose and Knowledge as its first act. Assumption: `area-operations.mjs:68` is the one template writer and the create path can reuse it. Not verified.

**D9. The template for a new Area's main note.**

```markdown
---
type: area
status: active
---

# <Name>

## Purpose

<What this Area is and what done looks like. One to three lines.>

## Knowledge

- Repository: `~/Projects/<name>`, branch `<name>`. Workers start here.
- `<command>`: <what it does and when to run it>.

## Current

## Ideas and open questions
```

Nineteen lines. The environment block arrives when Julian sets a default in the UI. Skills are files beside the note, not lines in it. The harness reads this note as a system prompt on every turn, so every line costs context each turn.

## 10. Rejected alternatives

- **A frontmatter field per resource.** Rejected: the README allows five frontmatter keys, and Julian said "freeform text for the brain to read".
- **A generated brain prompt** (C1). Rejected on Julian's word. The harness lane already exists and was verified in all three harnesses.
- **Rename the note to `AGENTS.md`** (C3). Rejected: wikilinks and the Document index key on the file name.
- **Keep `## Resources` as a machine section.** Rejected on Julian's word. The parser survives as a shortcut only.
- **Done Goal links leave `## Goals`, open ones stay.** The first revision recommended this. Julian went further: no Goal list in the note at all.
- **Ideas appended to the note by command.** Rejected with D6. The note is hand-written. The command gets its own file.
- **Clipping sections in the brain prompt.** Gone with the prompt.
- **Automatic pruning of Ideas or Knowledge by age.** Rejected: nothing auto-edits prose in this vault.
- **`tangent area check`** (C4). Deferred, not rejected. The strongest alternative. It loses because it is machinery before the rule has had one month.

## 11. Risks, assumptions, and unknowns

- Observed: claude, codex, and pi read symlinked `CLAUDE.md` and `AGENTS.md` chains, root and leaf (3.6). Unknown: agy, opencode, claude-gw, codex-gw. Test them before a brain runs on one.
- Unknown: pi asks before trusting a project folder with project skills (evidence file, pi README line 298). Whether it asks for context files alone was not tested. `~/.pi/agent/trust.json` covers the answer.
- Assumption: Obsidian shows a symlink as a note without harm. Not tested. The two names sit beside the real note in every folder.
- Assumption: brains obey a size guide when the root `AGENTS.md` names it. The UI signal is the reminder.
- Risk: with no folder check, a brain starts a worker in a wrong or missing path. The start fails with the harness's own error. `unboundAreaMessage` no longer applies.
- Risk: Codex's 32 KiB cap on the chain. A root note plus three route notes plus the root `AGENTS.md` fit under it only if each stays near the 100-line guide.
- Open point for Julian: the UI writes the `tangent.environment.v1` block into the note on his click (`launch-environment.mjs:183-201`). D6 says Tangent never writes a note. Two ways out: keep the block as the one exception, since his click is his own word, or move it to `<area>/environment.md`. Recommended: keep the exception. He named the default harness as the one exception earlier tonight.
- Risk: two places for ideas, `ideas.md` (the command's inbox) and the note section (curated by hand). The README's one-home rule holds if the brain empties `ideas.md` on each pass.
- Assumption: no reader depends on `areaGoalOrder`. The Area map and Work read it for order today (`server.mjs:970-975`). Both change to status then creation time.
- Unknown: whether the Area map's use of `Current` needs a fallback when Current is empty. Today 20 notes have an empty Current and the map works.
- Condition for reconsideration: if three notes pass 100 lines a month after the rules land, build C4.

## 12. Sources

- Julian's words: section 1, 2026-08-27 evening.
- Vault: `~/.tangent/trees/README.md` lines 15 to 27, 60 to 78. Notes named in section 3.
- Root `AGENTS.md` draft: scratchpad `vault-root-AGENTS.md`.
- Prior design: `../agent-shell-operating-vision/design-record.md` D1 to D4, D8, D11, D20, and `evidence/area-skills.md` section 2.
- Code: `packages/agent-shell/app/area-resources.mjs`, `launch-environment.mjs:51-61, 183-201, 240-259`, `area-brain-domain.mjs:38-41`, `area-operations.mjs:68`, `server.mjs:735-747, 958-959, 1312, 1345-1393, 6405-6420`.
- Instruction files: `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, `/Users/julianotto/Projects/otto-tangent/CLAUDE.md`, `packages/agent-shell/CLAUDE.md`.
- External: `https://code.claude.com/docs/en/memory`, `https://code.claude.com/docs/en/skills`, read 2026-08-27.
- Harness test: scratch repository `scratchpad/symtest`, 2026-08-27, `claude -p --model haiku`, `codex exec -s read-only`, `pi -p` under node 22.
- Git: `git log` on `otto/tangent/tangent.md`, `git log -L` on the Current sections of `live-edit.md` and `tangent.md`.
