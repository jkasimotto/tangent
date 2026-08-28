# A simple document ontology for the Otto vault

An independent study for a later design review. Nothing here is implemented, and no vault file or product code was changed.

Date: 2026-08-28. Goal: `otto/tangent/goal-study-a-simple-vault-document-ontology-with-clau.md`. Written by the Claude worker for that Goal, without reading the parallel Codex study. Evidence is from `~/.tangent/trees/otto` (all of it), the vault git history, the Agent Shell code and action log, and the design records under `docs/design`. Line numbers are as read on 2026-08-28 and will drift.

## The answer in one screen

The vault needs six kinds of thing. Four exist already. Two are new, and both are folders, not schemas.

| Kind | Where | Who writes | Who reads |
|---|---|---|---|
| Area note | `<area>/<name>.md`, with `AGENTS.md` and `CLAUDE.md` linking to it | the brain, Julian | every agent in that Area, every turn |
| Goal | `<area>/goal-<slug>.md` | Tangent, the brain, workers | Julian on Work, agents through the prompt |
| Document | any other `.md` directly in the Area folder; `design-<slug>.md` is the one named species | agents, Julian | Julian |
| Journal | `<area>/journal.md` | Tangent, when Julian says "remember this" | the brain, when Julian asks to be oriented |
| Records | `<area>/records/*.md` | agents | agents, and the brain when it answers "the records show" |
| Skills | `<area>/.agents/skills/<name>/SKILL.md`, with `.claude/skills` linking to it | Julian, the brain | the harness that opens in that folder |

One rule places every file. If Julian is meant to read it, it sits in the Area folder. If only agents are, it sits in `records/`. Nothing needs a `type:` line, because kind follows from name and place. Everything stays plain Markdown that Obsidian can open.

What this removes: `plan-<area>.md` as a second brain memory beside the note, `design-record-*`, `impl-*`, `rationale-*`, `result-*`, `research-*`, `finding-*` and `audit-*` as Julian-facing kinds, `ideas.md` as a fourth capture file, the unused `skill-<slug>.md` rule, the `type: work | project | routine` split on notes, the `Current brief` section in Goals, and every `type:` and `status:` line on Documents that nothing reads.

## What Julian asked

From the Goal instruction: a useful, simple document ontology for the Tangent/Obsidian vault. He reads designs today. Next he wants to talk to an Area brain about project state, progress, priorities, what matters and who is doing what, then have the brain store that and give it back correctly later. He needs a place for verbose agent-only communication. Markdown flexibility is precious. The result must be informal, low-ceremony, and aggressively resistant to over-formalization. Decide the smallest set of durable kinds and folder rules that removes loose notes without turning the vault into a CMS. Explain the roles of the Area note, designs, human and project memory, agent-only artifacts, the Journal or raw capture, records and pages. Say which distinctions to remove or fold. Say which few kinds deserve first-class UI. Distinguish what Julian reads from what agents use.

The brain added Julian's example: each Area will have `.agents/skills` and `.claude/skills`, symlinked. Decide their canonical home, whether they are an agent resource rather than a Document, how the two paths relate, inheritance into child Areas, and how to stop symlinks from making duplicate Documents or UI clutter.

Julian's own words that bind this study, from `docs/design/agent-shell-operating-vision/user-intent.md` (voice memos, 2026-08-27):

> You are overcooking it with terms etc. The operating philosophy is that tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents etc.

> I would rather organize my personal agent skills and like knowledge repository for how to do things by area in tangent rather than [by] repository.

> we don't need any like first class concept for this, I don't think. I think if we take the .agents folder and we also create a .claude folder and we [symlink] the .claude to the .agents within each area, then every brain will be aware of that, because the brains should open in the tangent repository.

> Almost all facts for brain should be stored in md.

And his reactions inside Documents, which show what over-formalization looks like to him: "What the fuck does this concretely mean?", "What the fuck is a resource lane?", "Have you just made this up?", "There is either active or inactive. That is all. Two states."

## What the Otto vault holds today

Counts are for `~/.tangent/trees/otto` on 2026-08-28. The subtree has 13 Areas and 506 files. Nearly all of it is 14 days old: 201 of the 202 Goals ever added under `otto` were added since 2026-08-14.

| Files | Count | Size | Who writes them | Who reads them | Evidence |
|---|---|---|---|---|---|
| Area notes `<name>.md` | 13 | 24 KB | brain, Julian, Tangent (status line, environment block) | harness chain every turn | 10 of 13 have an empty Purpose; 8 are untouched templates; `tangent.md` is 125 lines with 33 `- Idea` bullets and 207 commits |
| `goal-*.md` | 200 | 527 KB | Tangent creates, brain and workers update | Julian on Work, agents | 63 of 168 done Goals still say `State: Not started.`; `Current brief` copies `done_when` in every file read |
| `outcome-*.md` (old Goal name) | 49 | 117 KB | nobody now | index still accepts `type: outcome` | inert |
| `design-*.md` | 84 | 1.68 MB | workers, from the worker prompt rule at `server.mjs:1855` | Julian | 20 design files carry or carried his comments; every design `resolve:` commit in the vault (136) is on a design |
| `design-record-*.md` | 19 | 326 KB | design workers | later workers, sometimes | zero comments ever; the repo holds 21 more design records under `docs/design/` |
| `impl-*.md` (solution) | 32 | 850 KB | design and implementation workers | the brain, implementers | 2 files carried comments, both on 2026-08-20 |
| `rationale-*.md` | 77 | 296 KB | the finishing coding agent, per `design-learning-ai-written-code` decision 1 | the study tutor agent | zero comments; 3 of Julian's last 20 files opened in Obsidian were rationales |
| `plan-<area>.md` | 3 | 505 KB | the brain, appending per generation | the next brain generation | `plan-tangent.md`: 394 KB, 260 headings, 392 commits, last write 2026-08-26 |
| `result-`, `research-`, `finding-`, `audit-` | 4 | 175 KB | workers, names invented per Goal | whoever is told the path | one each |
| Unprefixed pages (`explicit-climbing-routes.md` and four more in `dnd`) | 5 | 17 KB | workers | Julian | designs in all but name, `status: accepted` |
| Screenshots `.png` | 6 | 3 MB | workers | nobody after the Goal | beside a finding and a Goal |
| `journal.md` | 1 (root only) | 300 B | Tangent on "remember this" | brains | one entry, an implementation proof |
| `ideas.md` | 0 under otto | | `tangent idea add` | the brain | the only one in the vault is `neara/delivery/cli/ideas.md`; otto's ideas went into the note |
| `skill-<slug>.md` | 0 anywhere | | | | the rule exists in README and D20; nobody used it |
| `.agents/skills/remember` | root only | | Julian | codex and pi natively; claude through `~/.claude/skills` | the only skill in the vault |
| Root loose files | `README.md`, `AGENTS.md`, `harnesses.md`, `threads.md`, `Untitled.md` | | mixed | mixed | `threads.md` is written by a `tangent threads sweep` that no longer exists; `Untitled.md` is Julian's raw Obsidian notes from a meeting |

Outside the vault, agents already talk at length in JSON: `~/.tangent/agent-shell/brains/otto/tangent/brain.json` is 520 KB with 326 generation handovers (median 1.2 KB, 400 KB in total), `inbox.json` holds 200 notices, `requests.json` is 125 KB, and `~/.tangent/agent-shell-messages.jsonl` holds 4,249 agent messages (3.5 MB, median 504 characters, longest 27 KB). This is the verbose agent-only communication Julian named. It has a place, but that place is not Markdown and not in the vault, so no agent can link to it, grep it, or hand it on with `--source`.

### What Julian reads, by evidence

- Comments: across all of `otto`, commit history shows Julian's `{>>Julian: ...<<}` comments on 20 design files, 4 Goals, 2 solution documents and 1 Area note. Never on a rationale, design record, plan, result, research, finding or audit.
- Resolves: every `resolve:` commit in the vault is on a design (136 commits, 15 distinct files under `otto`) or on one neara page (17 commits).
- Obsidian: `.obsidian/workspace.json` lists his last 20 opened files: 9 Goals, 3 designs, 1 design record, 3 rationales, 1 solution, 1 brain plan, 1 Area note, and `Untitled.md`.
- Agent Shell: the action log records 327 `GET /api/document` reads since 2026-08-23 and 470 brain opens; Work is opened 862 times. The log does not record which file was read.
- His words: "the work view is his everything view, so it must show work only" (2026-08-20); "when decisions need to be made, the card should just show him the doc name to read; he leaves comments in the Document and marks the decision done" (2026-08-20); "The Area view is rarely opened" (2026-08-20).

So the reading path is narrow and consistent: Work, then a design he was pointed to, then comments in it. Everything else is agents talking to agents.

### How the code sees a file today

`buildVaultIndex` knows three kinds: `note` (the file named after its folder), `goal` (a `goal-` or `outcome-` file whose frontmatter `type` is `goal` or `outcome`), and `document` (every other `.md` directly in the folder, minus `AGENTS.md` and `CLAUDE.md`; `server.mjs:719-742`, `INSTRUCTION_LINK_NAMES` at `:675`). A cosmetic `docKind` is then guessed from the filename prefix against `KNOWN_KINDS = ["design","impl","plan","reference","status","use-case","skill","goal","outcome","note","page"]` in `area-map-core.js:15`, or kept if two files share a prefix, else `page`. So `design-record-x.md` reads as a design, `rationale-x.md` is its own kind only because there are many, and `journal.md`, `ideas.md` and `harnesses.md` are pages.

Frontmatter on Documents is inert. `parseFrontmatter` is applied to Goals, Area notes, process notes and `skill-` notes only. `type: document`, `status: accepted` and `status: draft` are read by nothing, and the README's "allowed properties and no others" is already contradicted by 35 files with `type: design`, 5 with `type: impl`, 5 with `type: plan` and 2 with `type: design-record` across the vault.

Go To lists every Document including plans, rationales, journals, `ideas.md` and process notes, and excludes Goals (`go-to-rows.js:26-30`). The Goal reader lists Documents that the Goal links or that link the Goal, with presented documents first (`server.mjs:1030-1047`). The worker prompt hands a worker the Goal file, the Area note chain, the Goal's wikilinked Documents and the presented ones (`server.mjs:1835-1861`). The brain gets no prompt at all; its harness reads the `AGENTS.md` chain from its folder (ADR-0041).

Dot-directories are skipped by every walker (`TREE_SKIP` plus any dot entry, `server.mjs:533`, `:549`, `:1167`). `.agents/` and `.claude/` inside the vault are invisible. Symlink de-duplication is a name filter, not link resolution: any other symlinked `.md` in an Area folder would index as a second Document with its own backlinks. `vaultFingerprint` follows the two links and stats the note three times.

## Where it hurts

1. Six agent-written kinds per Goal. A single Goal can leave `design-`, `design-record-`, `impl-`, `rationale-`, and sometimes `result-` or `finding-` files beside the note, 1.6 MB of them in `otto/tangent`. Julian reads one of the six. The other five sit in Go To, the document browser and the Area map at the same rank as the design.
2. Three brain memories. The Area note (the rule says "the note is its memory"), `plan-<area>.md` (ADR-0024, 505 KB across three Areas, append-only generation logs) and the handover text in `brain.json`. ADR-0041 removed brain self-handover and the root `AGENTS.md` no longer mentions a plan file, so the plan file is orphaned: the last `plan-tangent.md` write was generation 290 on 2026-08-26 and the brain is at generation 326. Only the retired For Julian row code still reads it (`server.mjs:5100`, `:5149`). The note then absorbs what the plan file used to take: 33 dated bug reports and observations under Ideas in `tangent.md`, against a rule of ten lines and no dates.
3. Four homes for a raw thought: `journal.md` (Julian's exact words), `ideas.md` (`tangent idea add`), the note's Ideas section (hand-written), and Julian's own `Untitled.md` in Obsidian.
4. Two homes for the same engineering record. The `design` skill says "Do not prescribe a storage location". This repository puts records at `docs/design/<topic>/design-record.md` (21 folders); the vault got `design-record-<slug>.md` (19 files). `docs/design/prepared-review-requests/design.md:12` names its own vault copy. `docs/design/agent-shell-presented-documents/design-record.md:18` records the consequence: a worker that follows the repository convention produces a document Julian cannot open in Agent Shell. ADR-0033 draws the line ("the vault owns Area facts, Journals, Goals, and Documents; a bound repository owns code-agent instructions and architecture records") but says nothing about a design record for a Goal, which is neither.
5. Goal bodies do not hold the truth. 63 of 168 done Goals under `otto` still read `Not started.` The queue JSON and the brain know the state; the file does not. `Current brief` restates `done_when`. `Story so far` is useful where it exists (87 Goals have real entries) and empty ceremony elsewhere.
6. Frontmatter is theatre. Documents carry `type:` and `status:` lines that no code reads and that the README forbids.
7. Kinds are invented per Goal. Under `neara` the prefixes include `review-`, `review2-`, `review3-`, `review4-`, `doc-`, `map-`, `draft-`, `wrapup-`, `vision-` and `status-`. The UI's `page` fallback hides the invention but the files stay loose.
8. Skills have four homes and none of them is an Area. The README and D20 define `skill-<slug>.md` (zero files exist). The vault root has `.agents/skills/remember`. Repositories have `.claude/skills` (listed by `tangent area show`). The home directory has `~/.agents/skills` as the real files with `~/.claude/skills` holding per-skill links plus five real folders; the two drifted once and the loaded `remember` lost a whole section (`tangent.md`, Knowledge).
9. Symlinks are handled by name, so the next symlink duplicates.

## The proposal, kind by kind

### 1. The Area note: the system prompt, and the only universal file

Role: what is true now and what every agent must know every time. It is read on every turn by every harness in the Area, so its size is context cost. That is why it has four sections, a 100-line guide and a rewrite-never-append rule, and why it cannot also be the brain's long memory. Keep the shape settled in `docs/design/area-note-as-system-prompt`: Purpose, Knowledge, Current, Ideas and open questions, with the environment block Tangent writes.

What changes: nothing in the file, one thing around it. The note stays under 100 lines only if there is somewhere else to write. Today there is not, so dated bug reports and observations pile up under Ideas. With `records/` (kind 5) the brain has a place for everything that is not a Goal and not durable Knowledge, and the rule "a bug is a Goal, an observation is a record, a fact is Knowledge, a thought is ten lines of Ideas" becomes followable.

Fold: drop `type: work | project | area | routine` and the project-only sections (Objectives, Milestones, Road to finish). One note shape. The `status:` line stays because `done` and `archived` fold the Area away. The three files `dnd.md`, `AGENTS.md` and `CLAUDE.md` are one note; the index already knows that by name and should know it by link resolution instead (see UI).

Julian reads the note rarely (one comment ever, on `tangent.md`). That is fine. It is written for agents; he reads its digest when he asks the brain to orient him.

### 2. Goals: unchanged in kind, lighter in body

A Goal is one file, machine-owned frontmatter, human done condition. Keep it. Two folds inside the body:

- Remove `Current brief`. Its "You wanted" bullet is a copy of `done_when`; the other two bullets are never filled in the files read.
- Keep `Story so far` but make it optional and stop seeding it with "Goal defined. The result was saved." A finished Goal with a real story is a good return aid; an empty scaffold is noise.
- `## Sources` stays as the link list the prompt reads. Presented documents stay a runtime record (`presented/`), never a property of the file.

The 49 `outcome-*` files are done Goals in the old name. One `git mv` sweep by Tangent (never by hand, per the README) would end the last node-and-outcome vocabulary seam. Or leave them; they are inert. Low priority either way.

### 3. Documents, with design as the one named species

A Document is anything Julian is meant to read, and it lives directly in the Area folder. `design-<slug>.md` is the only prefix worth keeping, because it names the one interaction Julian has with documents: read it, comment in it, accept or reject it. Every other Julian-facing page keeps whatever name says what it is (`terrain-travel-costs.md` is fine). No frontmatter is required; a one-word `status:` line does no harm and no code reads it, so the README should stop pretending it is a schema.

Simple English and the short-document rules apply here and nowhere else. They exist to protect Julian's reading time. Agent-only writing is free of them.

Solution documents (`impl-*.md`) are the borderline case: they are written for the brain and the implementer, and Julian commented on two of them on one day. Rule: a solution document is a record unless a worker presents it, and presenting works for any vault file wherever it sits. Audience decides placement; presentation flags attention. That is one rule, not a taxonomy.

The five accepted pages in `otto/dnd` (`explicit-climbing-routes.md` and friends) are designs in everything but name and can stay as they are. New ones would carry `design-` so Go To and the reader label them the same way.

### 4. The Journal: Julian's memory, verbatim

The Journal is already designed and built (`docs/design/agent-shell-work-briefing`, `area-brain-domain.mjs:33-115`): one `journal.md` per Area, one complete user turn per entry, append-only, idempotent by marker, rolled over at 256 KiB, routed by exact excerpt only. Nothing to add to it. It is the answer to "have the brain store and later regurgitate that context correctly": the brain stores Julian's words, not its paraphrase, and answers with "You said" from the Journal, "The records show" from Goals and records, and "My read is" for the rest, exactly as the root `AGENTS.md` already instructs.

Fold `ideas.md` into it. An idea from `tangent idea add` is a Julian one-liner; save it as a Journal entry with `Source: idea` and let the brain harvest it into a Goal, a Knowledge line, or the ten-line Ideas section, without deleting anything. Then a thought has one raw home (the Journal), one digest (the note's Ideas section), and Julian's own Obsidian scratch stays his own business.

So human memory is the Journal (exact) plus Knowledge (digested). Project memory is the note's Current plus the Goals plus git. Those four are enough.

### 5. Records: the agents' drawer

New: one folder per Area, `<area>/records/`. What goes in it is everything an agent writes that Julian is not being asked to read: rationales, solution documents, design records, results, research, findings, audits, screenshots, worker handovers that want to be Markdown, and the brain's own long file. Rules inside it: name the file for what it is, link the Goal, and that is all. No Simple English. No length limit. Append if you like. No frontmatter. `records/` is a reserved folder name like `shared`, never an Area.

This is the place for verbose agent-only communication Julian asked for. Reasons for each choice:

- In the vault, not in runtime JSON, because Markdown is what agents can link, grep, hand on with `--source`, present when it matters, and read in Obsidian. Git keeps provenance with the same one-save-one-commit rule.
- A folder, not another prefix, because the flat folder is the mess. One folder is one line in the index, one collapsed row in Obsidian, one rank rule in Go To.
- Visible, not a dot-folder, because Obsidian cannot show dot-folders and 3 of Julian's last 20 Obsidian files were rationales. Obsidian's Excluded files setting (`.obsidian/app.json`, which is `{}` today) keeps `records/` out of search and graph without hiding it from the file tree.
- The brain's long file lives here too. Keep the name it has, `plan-<leaf>.md`, moved to `records/`, or call it `brain.md`; either is one path change in `newBrain` (`server.mjs:4717`). This closes the hole ADR-0041 opened when it deleted handover: the brain gets its scratch back, out of the prompt and out of Julian's view.

One sweep moves the existing files: in `otto/tangent` that is 19 design records, 32 solution documents, 77 rationales, one research file and the plan; in `otto/dnd` the audit, the finding, the plan and six screenshots. After it, `otto/tangent` holds one note, 200 Goals, 84 designs and a Journal. That is what "eliminate loose notes" looks like in file counts.

Reservation risk: `records` could be a real subject one day (`otto/finance/records`). The README lists it beside `shared`, and `tangent area create` refuses it. If that ever bites, the alternative is a name no subject would take, and the folder rule stays the same.

### 6. Skills: an agent resource, not a Document

A live Goal already implements this layout: `unify-tangent-area-skills-with-agent-skill-disco` ("Area skills use one directory convention that Codex and Claude discover automatically, Tangent inherits and supplies those skills correctly, and existing skill-slug documents are migrated or remain compatible"). This study takes its layout as given and only places skills in the larger picture.

Canonical home: `<area>/.agents/skills/<name>/SKILL.md`. Compatibility: a real `<area>/.claude/` folder holding one link, `skills -> ../.agents/skills`. Link the skills folder, not `.claude` itself, because Claude Code writes `settings.local.json` into `.claude/` and a folder-level link would put that file into `.agents/` and into the vault's git. The sweep that already writes the `AGENTS.md` and `CLAUDE.md` links writes this link too, and never copies.

Kind: a skill is a resource the harness loads, not a Document. It gets no index record, no comments, no wikilinks, no Go To row, no Area map node. It is listed by `tangent area show` from the root to the Area, name and description only, exactly as project skills are listed today (`PROJECT_SKILL_FOLDERS` in `area-skills.mjs:14` walks only the bound repository; it needs to walk each Area folder on the route as well). That listing is the whole UI. Delete the `skill-<slug>.md` rule; zero files use it and it made a how-to into a Document with comment counts and backlinks for no reader.

Inheritance into child Areas is free, by the harness, not by Tangent. Codex scans `.agents/skills` in every directory from the working directory up to the git root; pi does the same; Claude Code loads `.claude/skills` from the working directory and every parent up to the repository root (vendor docs as fetched in `docs/design/agent-shell-operating-vision/evidence/area-skills.md`, section 2). The vault is one git repository, so a brain that opens in `otto/dnd/players` sees the skills of `otto/dnd`, `otto` and the root. This holds because a brain always opens in its Area folder in the vault, whatever the Area binds (`spawnBrainSession`, `server.mjs:4547`); the live `tangent-brain-g326` runs in `~/.tangent/trees/otto/tangent`. Worker folders are resolved separately through `areaWorkFolder` (`server.mjs:472`).

Workers never see Area skills, and should not: they open in the work repository. The brain hands a skill on by naming its absolute path in the instruction, as the root `AGENTS.md` already says. `--source` cannot carry it today because `sourceDocuments` accepts only indexed Documents; either leave that as is and use the path, or let `--source` accept any readable vault file. The path is enough.

Duplicates and clutter: dot-folders are already invisible to every walker, so a skill can never become a Document by accident. The note links are the only symlinks the index sees, and it should resolve them by `realpath` rather than by name so that the next link (skills, or a note moved by hand) cannot duplicate anything. The home directory gets the same shape: `~/.agents/skills` is already canonical, `~/.claude/skills` becomes one folder link once its four remaining real folders move across, and the recorded drift cannot recur.

## What the brain keeps when Julian talks to it

Julian's next use is a conversation about state, progress, priorities, what matters, and who is doing what. Each of those has one home, and none of them needs a new kind.

| Julian says | It goes to | The brain gives it back from |
|---|---|---|
| what matters, priorities, doubts, "remember this" | the Journal, exact words | "You said", the Journal |
| a current fact or convention | Knowledge in the note | the note |
| what is in motion, in his words | Current in the note, five lines | the note |
| a bug or a wanted change | a Goal, parked if not now | Work, `tangent goal list` |
| a passing thought | Ideas in the note, ten lines | the note |
| who is doing what | the Goal title or Current, as free text (`Troy · PLDB mismatch check` already works this way) | Work |
| the brain's own reasoning, hazards, generation notes | `records/` | "The records show", when asked |

Progress and activity are already machine records (`milestones.json`, the queue, git). People are the one thing without a home; Julian deferred the assignee concept himself (2026-08-24). Free text in titles and Current is enough until that decision, and the ontology should not pre-empt it.

## Which kinds deserve first-class UI

Three, and they are the three Julian touches.

1. Goals, on Work. Already first-class.
2. Documents Julian is asked to read: presented rows under a Goal, Decision requests that name a document, and the reader with comments. Already designed; the only change is that presentation is the sole attention signal and folder is the sole audience signal.
3. The Area note, on the Area page, with its `<n> lines · Current <d> days old` line. Already built. Rarely opened, and that is by design.

Deliberately second-class: the Journal (its UI is the conversation; one Go To row per Area is plenty), records (Go To ranks them last or behind a `records:` filter, the Goal reader lists them dimmed after Documents, the Area map leaves them out by default), and skills (`tangent area show` only).

Concrete code implications, for the design that follows this study:

- Index: reserve `records`, read its `.md` files as `kind: "record"`, resolve symlinks with `realpath` before de-duplication, stop stat-ing the note three times.
- Go To: rank records last; show Goals (they are the thing Julian looks for most and are excluded today).
- Goal reader: Documents first, then records, dimmed.
- Area map: records off by default; skills never.
- Worker prompt (`server.mjs:1855`): one added sentence, "everything else you write goes in `records/`", and the Simple English clause scoped to designs.
- Brain: `planFile` moves to `records/`; the note-signal stays.
- `tangent area show`: walk `.agents/skills` on the Area route.
- Vault sweep, once, by Tangent: `git mv` the record kinds into `records/`, fold `ideas.md` into the Journal, delete `threads.md`, write the `.claude/skills` links.
- README: replace the Node notes, Outcomes and Processes and skills sections with the short rules below.

## The vault rules as they would read

This is the whole ontology, at the length Julian can hold in his head. It would replace about 90 lines of the current README.

```markdown
## Files

An Area is a folder. Its note is `<name>.md`; `AGENTS.md` and `CLAUDE.md` link to it.
The note is the standing instruction and the present state: Purpose, Knowledge,
Current, Ideas. Under 100 lines. Rewrite, never append. No dates, no bug reports.

A Goal is `goal-<slug>.md`. Tangent writes its frontmatter; agents write its State.

Anything else in the Area folder is a Document, and a Document is for Julian.
A design is `design-<slug>.md`, in Simple English, linking its Goal. Other pages
take any name that says what they are. No frontmatter is needed.

`journal.md` is what Julian said, word for word. Tangent writes it. Nobody edits it.

`records/` is for agents: rationales, solutions, design records, results, findings,
the brain's own notes. Link the Goal. No other rules. `records` is never an Area.

`.agents/skills/<name>/SKILL.md` is a skill the harness loads. `.claude/skills`
links to it. Skills are listed by `tangent area show` and are not Documents.

`process-<slug>.md` is repeatable work; `harnesses.md` at the root is the harness
registry. Both are Documents with a few lines of frontmatter that Tangent reads.

If Julian is meant to read it, it sits in the Area folder. If only agents are,
it sits in `records/`. Nothing else decides where a file goes.
```

## Simplicity tests

Use these to check the design that follows, and to refuse additions later.

1. Zero-frontmatter test. A new agent writes any file with no frontmatter and it lands in the right kind by name and place alone. Goals and process notes are the only files where Tangent needs a line to read.
2. One-breath test. Julian can name every kind without looking: note, Goal, design, Journal, records, skills.
3. Delete test. Delete every `records/` folder in `otto` and nothing Julian reads changes. If something he reads disappears, it was in the wrong place.
4. Empty-Area test. A folder with only `<name>.md` is a complete Area. No folder is created until something is written into it.
5. Screen test. The vault rules fit on one screen. The block above is the budget.
6. Thirty-day test. Any prefix or folder with fewer than three files after thirty days is folded into its neighbour. Today that fails for `result-`, `research-`, `finding-`, `audit-`, `skill-`, and `ideas.md`.
7. Note test. `tangent.md` is under 100 lines and Current is under 14 days old for two weeks running. If the note bloats again with `records/` available, the rule is wrong, not the brain.
8. Orientation test, from the Work Briefing design: after one mixed turn saved with "remember this", a fresh brain restores Julian's view without him explaining it again, using only the Journal, the note, and Goals. If it needs a record, the record was Knowledge.
9. No-new-word test. Every name in this study already appears in Julian's words or the vault: note, Goal, design, page, Journal, records, skills. "Records" is his word in the assignment and the brain's in "The records show".

## Uncertainties

1. Julian and rationales. He has never commented on one in Agent Shell, but three of his last twenty Obsidian files were rationales. `records/` keeps them one click away in Obsidian and in Go To; it does not hide them. If he wants a rationale in his face, the finishing worker presents it.
2. Claude Code and symlinked skills. The vendor docs say a skill folder can be a symlink and that project skills load from the working directory and every parent up to the repository root. Whether a symlinked `.claude/skills` folder inside a git repository is followed was not tested here. Test: put one skill in `otto/dnd/.agents/skills`, link `otto/dnd/.claude/skills`, start `claude-otto` in `otto/dnd/players`, and check the skill list. Codex was not tested either; its binary names `.agents/skills`, and Claude's names only `.claude/skills`.
3. Obsidian and symlinks. `AGENTS.md` and `CLAUDE.md` most likely show as three files per Area in Obsidian's explorer and search. Julian has not said whether that bothers him. The Excluded files setting can hide the two link names.
4. Git noise from records. `plan-tangent.md` alone made 392 commits in nine days. Moving it changes nothing about that. If the brain commits its long file every turn, vault history fills with `update:` commits nobody reads. Committing the brain file once per generation, or on request, is a policy question for the design.
5. Repository design records. This repository's `docs/design/<topic>/design-record.md` convention stays, because ADR-0033 gives architecture records to the repository and later workers read them there. The rule for a Goal's design record is then: `records/` in the vault by default, the repository only when the repository's own rules ask for it. Tangent's own repository is such a case. That is two homes with one rule, and it should be said out loud in the README rather than left to the skill.
6. `records` as a reserved name. Plausible as a subject under `finance`. Named above; Julian's call.
7. Ideas into the Journal. The Journal's contract is "complete user turn, exact text". An idea from `tangent idea add` is a one-liner typed into a form, so it fits the contract, but the Work Briefing design did not consider it. If the Journal must stay only spoken turns, `ideas.md` stays as the one exception and the fold is off.
8. The Codex study. This study was written without it. Where the two agree, the design can move fast. Where they differ, the difference is the first question for the review.

## Sources

- Vault: `~/.tangent/trees/README.md`, `AGENTS.md`, `otto/**` (all files), `.obsidian/workspace.json`, `.agents/skills/remember/SKILL.md`; git history of `otto` (2,497 commits).
- Runtime: `~/.tangent/agent-shell/brains/otto/tangent/{brain.json,inbox.json,requests.json,milestones.json}`, `~/.tangent/agent-shell-actions.jsonl`, `~/.tangent/agent-shell-messages.jsonl`.
- Code: `packages/agent-shell/app/server.mjs` (`readAreaDocuments`, `buildVaultIndex`, `goalPrompt`, `goalContextDocuments`, `newBrain`, journal routes), `area-map-core.js`, `go-to-rows.js`, `area-note-links.mjs`, `area-skills.mjs`, `area-brain-domain.mjs`, `document-comments.js`, `brain-requests.mjs`.
- Design records: `docs/design/area-note-as-system-prompt/`, `agent-shell-operating-vision/` (user intent and `evidence/area-skills.md`), `agent-shell-work-briefing/`, `agent-shell-presented-documents/`, `agent-shell-work-contract/`; ADR-0020, 0023, 0024, 0033, 0040, 0041, 0043.
- Neighbouring Goal: `otto/tangent/goal-unify-tangent-area-skills-with-agent-skill-disco.md` and its queue instruction.
- Vault designs: `otto/tangent/design-define-tangent-s-ontology.md`, `design-living-documents.md`, `design-agents-present-their-documents.md`, `design-agent-shell-work-briefing.md`, `outcome-design-documents.md`, `outcome-evaluate-vault-md-structure.md`.
