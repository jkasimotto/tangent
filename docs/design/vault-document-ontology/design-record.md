# A simple ontology for vault documents: design record

Date: 2026-08-28. Status: designed, not implemented. Goal: `otto/tangent/goal-design-a-simple-ontology-for-vault-documents.md`. Read `user-intent.md` first.

This record synthesizes two independent studies written on the same day without sight of each other. One is `study-claude.md` beside this file (commit `340172e`). The other is the Codex study in the vault, `otto/tangent/design-simple-vault-document-ontology.md`. Where the studies agree, the record adopts the shared answer. Where they differ, the record resolves the difference from evidence and names the evidence. It does not average.

Lenses: product experience (the brain conversation and Julian's reading path), architecture and data (placement, ownership, the index), migration and compatibility (about 500 existing files under `otto`). The API lens applies to four small points: `tangent area create`, `--source`, `--present`, and the vault commit trailer. No operations lens: no runtime behavior changes.

Facts are labeled Observed, Decision, Assumption, Proposed generalization, or Unknown. Vault paths are relative to `~/.tangent/trees`. Repository line numbers are as read on 2026-08-28 in the working tree and will drift.

## 1. Problem contract

**Root problem.** The vault has a rule for the files Julian reads and no rule for the files agents write. So agents put everything beside the note. `otto/tangent` holds 351 Markdown files in one folder. They are 156 Goals, 26 old outcomes, 68 designs, 19 design records, 18 solution documents, 59 rationales, one research file, one 394 KB brain plan, the note, and two instruction links. Julian reads the designs. Everything else sits at the same rank in Go To, the Goal reader, and the Area map.

The blocked outcome has two halves. Julian cannot talk to a brain about state, priorities, and people and trust that the brain files it where a later brain will find it. Agents have no place for verbose writing that is not in his face.

**Constraints**, from the Goal instruction and Julian's words:

- Informal and aggressively simple. No knowledge-management system, no maintenance by Julian, no schema, no proliferating kinds.
- Plain Markdown that Obsidian opens. Flexible names. Graceful ambiguity: a file in the wrong place is still readable and still linkable.
- No new terms. Every name is already in Julian's words or in the vault.
- Settled decisions stay settled. The note is `AGENTS.md` (area-note record D1, ADR-0041 D5). Tangent never writes into a note (ADR-0041 D6). The Journal contract holds (work-briefing record). Workers only send (ADR-0040). Processes are notes (ADR-0043). Presentation is attention state (presented-documents record D1).
- Skills implementation belongs to `goal-unify-tangent-area-skills-with-agent-skill-disco`. Its assignment 2 is running. This record places skills in the ontology and does not design their discovery.

**Non-goals.** A content-management system. A `type:` taxonomy in frontmatter. Reading state. A model that classifies files. A Goal body redesign. A people or assignee concept (Julian deferred it on 2026-08-24). A Go To redesign. A change to the Journal capture contract. An Obsidian plugin.

**Success conditions.**

1. A writer places any new file by one question, who reads it, and needs no frontmatter.
2. After the sweep, `otto/tangent` holds the note, Goals, designs, the Journal, and one folder. Go To and the Goal reader show Julian's files first.
3. A brain files one mixed informal turn into the note, Goals, and the Journal without asking Julian where anything goes. It says in one line per item what it did.
4. A fresh brain orients Julian from the Journal, the note, and Goals alone.
5. Every kind that keeps a name has product behavior that no other kind has.
6. The rules fit on one screen of the README.

## 2. The two studies

Observed. Both studies inspected the whole `otto` subtree, the vault history, the Agent Shell code, and the design records. They agree on more than they differ.

### 2.1 Shared answers, adopted as they stand

- The Area note is the standing instruction and the short current memory. Its shape is the area-note record's. Under 100 lines. Rewrite, never append.
- The Journal is Julian's exact words, as designed and built. It is not current truth.
- `design-<slug>.md` is the one Document name with product meaning.
- Agents need one bounded place of their own, outside Julian's reading surface.
- Skills are an agent resource, not a Document: `<area>/.agents/skills/<name>/SKILL.md`, with `<area>/.claude/skills` linked to it. Not indexed. Listed once.
- Frontmatter is not a type authority. Kind follows from name and place.
- The prefixes `impl`, `plan`, `reference`, `status`, `use-case`, `rationale`, `result`, `research`, `finding`, and `audit` stop being kinds.
- Goals stay the work object. Outcomes are legacy. Processes stay executable notes.

### 2.2 Differences and their resolution

| Question | Codex study | Claude study | Resolved | Decisive evidence |
|---|---|---|---|---|
| Where agent-only files live | `<area>/.agents/artifacts/`, hidden | `<area>/records/`, visible, reserved | `records/` (D4) | Every Tangent walker skips dot-folders (`server.mjs:551`, `area-operations.mjs:46`), so a dot-folder is unreachable by Go To, the reader, wikilinks, `--source`, and `--present`. Obsidian hides dot-folders (Assumption, section 14). Julian opened four rationales in Obsidian among his last 36 files (section 3.2). |
| A named "Page" kind | Yes, the human fallback | No, a Document with any name | No Page (D3) | No product behavior differs between a Page and a Document. Julian's product word is Document (living-documents, ADR-0033, the reader). "Page" is a new term. |
| `ideas.md` | Keep, do not index it as a Page | Fold it into the Journal | Keep (D6) | ADR-0041 D6 is one day old and Julian's. The Journal contract is one complete user turn in Julian's own words. 30 of the 33 ideas in `tangent.md` were brain-written bug reports, not his words (area-note record section 8). |
| `plan-<area>.md` | Split into note, Goals, runtime, and an optional artifact | Move it to `records/` as the brain's scratch | Both: no plan kind, existing files move to `records/`, a brain keeps scratch there (D5) | ADR-0041 removed handover. The plan's last write was generation 290; the brain is past 326. Its only reader is the retired For Julian code (`server.mjs:5101-5114`, `5776`). |
| Migration | Gradual, no bulk rename before the model is useful | One sweep by Tangent | Both, in order: the rules bind new files at once, the sweep moves old files on Julian's word (D14) | Wikilinks resolve by file stem in Obsidian and in the index (`linkTargetsRecord`, `server.mjs`), so a move breaks no link. The rule works without the sweep. Go To is clean only after it. |
| First-class UI | Area note, Design, Journal | Goals, presented Documents, Area note | The three surfaces that exist: Work, the reader, the Area page. Design is the one Document label. Records rank last (D12) | Julian: "the work view is his everything view". Comments happen in designs (section 3.2). The Area page already holds Journal capture and History (`area-directory-view.js:276-283`). |
| A Goal's design record | A Design, or an artifact | `records/`, except where the work repository has its own home | The work repository's documented home wins, else `records/` (D4) | ADR-0033: a bound repository owns architecture records. This repository has `docs/design/`. `otto/dnd` has none. |
| Skills in child Areas | Read ancestors root to leaf; a repeated name on one route is a conflict | The harness walk does it; nothing for Tangent to build | Harness walk; duplicate names are the unify Goal's question (D8) | Vendor docs: Codex and pi scan `.agents/skills` from the working directory up to the git root; Claude Code loads `.claude/skills` the same way (`../agent-shell-operating-vision/evidence/area-skills.md` section 2). The vault is one git repository. Duplicate behavior is Unknown until tested. |

## 3. Current system (Observed)

### 3.1 What the vault holds

`otto/tangent` on 2026-08-28: 351 Markdown files directly in the folder. By name: 156 `goal-`, 26 `outcome-`, 68 `design-`, 19 `design-record-`, 18 `impl-`, 59 `rationale-`, 1 `plan-`, 1 `research-`, the note, and the two instruction links. Three child Areas (`area-map`, `desk`, `model`) hold their own notes and Goals. `otto/dnd` holds 11 designs, 11 solutions, 9 rationales, 23 outcomes, 19 Goals, one plan of 102 KB, one audit, one finding, and five screenshots. It also holds five unprefixed pages with `status: accepted` in their frontmatter. `otto/launcher` holds one plan, two rationales, one result, one design, and seven Goals. The Claude study counts the whole subtree: 506 files, 13 Areas, and 201 of the 202 Goals ever added since 2026-08-14.

Captures: one `journal.md`, at the vault root, with one entry, an implementation proof. Zero `ideas.md` under `otto`. The only one in the vault is `neara/delivery/cli/ideas.md`, with two agent-written lint ideas. Zero `skill-<slug>.md` anywhere. One skill, `.agents/skills/remember`, at the root. Stray root files: `threads.md` (written by a deleted command) and `Untitled.md` (Julian's own meeting notes from Obsidian).

Frontmatter on Documents: `type: document`, `type: design`, `status: accepted`, `status: proposed`, `status: note`, in inconsistent combinations, read by nothing. The README says "allowed properties and no others". The files do not obey it.

The vault working tree also has ten uncommitted edits to `otto/dnd` and `otto/tangent` files from another session. This record leaves them alone.

### 3.2 What Julian reads

- Comments. Files under `otto` that carry a `{>>Julian: ...<<}` mark today: 7 designs, 2 Goals, 2 solution documents, and 1 rationale with an empty placeholder. The two solution documents were the test bed of the comment feature on 2026-08-20 (`impl-second-comment-lands.md`, 30 comment lines). Under `neara`: 2 designs, 2 plans with placeholders, and `go95-pgande-difficulties.md`, an unprefixed page with 7 substantive comments. The Claude study reports, from history, comments on 20 designs, 4 Goals, 2 solutions, and 1 note. It reports every `resolve:` commit in the vault on a design or on that one page.
- Obsidian. `.obsidian/workspace.json` `lastOpenFiles`, 36 entries: 10 Goals, 5 designs, 1 design record, 4 rationales, 1 solution document, 5 plans (4 as temporary files), 2 notes, 2 other Documents, and 6 folders.
- His words. 2026-08-20: "the work view is his everything view, so it must show work only". "the card should just show him the doc name to read; he leaves comments in the Document and marks the decision done". "The Area view is rarely opened". 2026-08-27: "Everything is basically md and agents and a few helpers from tangent cli."

Proposed generalization. Julian's reading path is Work, then a design he was pointed to, then comments in it. He opens agent-written files in Obsidian now and then. He has never commented on one.

### 3.3 How the code sees a file

- Areas. `readTree` (`server.mjs:542-560`): every directory that is not in `TREE_SKIP` (`.git`, `.obsidian`, `shared`, `node_modules`) and does not start with a dot is an Area. `area-operations.mjs:6` holds the same reserved set for `tangent area create` and `move`. A folder named `records` is an Area today.
- Documents. `readAreaDocuments` (`server.mjs:722-745`): every `.md` directly in the Area folder that is not the note, `AGENTS.md`, `CLAUDE.md`, or a `goal-` or `outcome-` file is `kind: "document"`. Non-recursive. Symlinks are excluded by name (`INSTRUCTION_LINK_NAMES`, `server.mjs:678`), not by target. A `skill-` file gets a `skill` field (commit `b26e644`).
- Cosmetic kind. `areaMapCore.assignKinds` (`area-map-core.js:35-61`) takes the file-name prefix when it is in `KNOWN_KINDS` (`design`, `impl`, `plan`, `reference`, `status`, `use-case`, `skill`, `goal`, `outcome`, `note`, `page`), or when two files share it, else `page`. So `design-record-x` is a `design`, `rationale-x` is a `rationale` because there are many, and `journal.md` is a `page`. Go To prints that label and excludes Goals (`go-to-rows.js:26-30`).
- Relations. Wikilinks only. The index resolves `[[stem]]` by file stem and `[[path/stem]]` by path (`buildVaultIndex`, `server.mjs:932-1080`. `linkTargetsRecord`). A Goal's Documents are the linked or back-linked Documents, presented ones first.
- Prompts. The worker prompt says: "Design documents go in the Area folder ... as design-<slug>.md, in Simple English ..., with a [[goal]] link. Present each document with --present <file> when you send the brain your result." (`server.mjs:1857`). Nothing tells a worker where anything else goes. The brain gets no prompt. Its harness reads the `AGENTS.md` chain (ADR-0041 D5).
- Brain memory. `newBrain` still sets `planFile: plan-<leaf>.md` (`server.mjs:4719`). Its only readers are `brainPlanText` and the For Julian rows (`server.mjs:5101-5114`, `5776`), retired code inside the ADR-0033 audit window. `plan-tangent.md` has 152 `##` headings, all `Status (generation N ...)` or `Proposal`, last written 2026-08-26.
- Journal. `area-brain-domain.mjs:11-95`: `journal.md` per Area, a marker per entry, a 256 KiB rollover into `journal-<from>-<to>.md`, idempotent by marker. The Area page has a capture composer and "Read the Journal and finished work" (`area-directory-view.js:276-283`, `336`). The root brain reads every Journal. An Area brain reads its subtree and routed entries (root `AGENTS.md`, Journal memory).
- Skills. `area-skills.mjs`: `skill-<slug>.md` notes per Area, listed root to leaf by `tangent area show`, plus the bound repository's `.claude/skills` and `.agents/skills` (`PROJECT_SKILL_FOLDERS`, line 15). Vault-level `.agents/` folders are not walked.
- Ideas. `tangent idea add` writes `<area>/ideas.md` (ADR-0041 D6).

### 3.4 How agents talk today, outside the vault

Observed by the Claude study. `~/.tangent/agent-shell/brains/otto/tangent/brain.json` is 520 KB with 326 generation handovers. `~/.tangent/agent-shell-messages.jsonl` holds 4,249 messages, 3.5 MB. This is the verbose agent-only communication Julian named. It has a home, but that home is JSON outside the vault. No agent can link it, grep it, or hand it on with `--source`.

## 4. Precedent

Internal.

- The note is `AGENTS.md` by symlink (area-note record D1): one real file, links to it, resolved by the harness. The `.claude/skills -> ../.agents/skills` link copies that shape.
- `shared` is a reserved folder name that is never an Area (`TREE_SKIP`, README). `records` joins it.
- Presentation is attention state outside the vault (presented-documents D1). In this record placement is audience and presentation is attention. Two orthogonal facts, no taxonomy.
- The Journal is one file per Area with one writer, Tangent (work-briefing D6, D9). `ideas.md` has the same shape with one writer, `tangent idea add`.
- This repository keeps engineering records in `docs/design/<topic>/design-record.md` and Julian-facing prose in the vault as `design-<slug>.md` (presented-documents record, section 1 cause 4). The rule for other repositories follows from ADR-0033.

External.

- `AGENTS.md`, `CLAUDE.md`, and `.agents/skills` are the harness conventions Julian named. Dot-folders are for tooling, and Obsidian, Finder, and most explorers hide them. That is what makes a dot-folder wrong for files a human opens sometimes.
- Documentation repositories separate reader prose (`docs/`) from working material (`.github/`, `scripts/`, `tools/`) by folder, not by frontmatter.

## 5. Lens analysis

### 5.1 Product experience

**Journey A, the informal dump.** Julian opens the `otto/tangent` brain and talks. He names what matters this week, what can wait, a doubt about a direction, a bug he saw, and who is on what. He says "remember this" at the end, or he does not.

1. If he said "remember this", Tangent saves the complete turn to `otto/tangent/journal.md` before the brain answers (work-briefing D5). The brain sees the notice.
2. The brain files the turn by the rule in section 8 without a question. Current is rewritten in three lines. One Goal is created and parked. One Knowledge line is written if a fact will change how agents work. The doubt gets nothing beyond Current and the Journal. The person's name is free text in the Goal title.
3. The brain answers with one line per destination: "Journal saved. Current now says .... Created Goal ... (parked). Knowledge: ...". Nothing else. If he did not say "remember this", the first line is absent, and the brain's paraphrase in Current is the only record of his words.
4. Julian leaves. A week later he opens a fresh brain and says "where was I". The brain reads the Journal in scope, then the note, then Goals and records. It answers in the three voices of the root `AGENTS.md`: "You said ...", "The records show ...", "My read is ...".

States. An empty Journal: the brain says so and orients from the note and Goals. A turn that mixes Areas: the brain files its own Area and proposes one exact route to the other (work-briefing D7, D8). A turn that names a bug: a Goal, never an idea line. A turn that names a person: free text, no field.

**Journey B, reading.** A worker finishes and presents `design-x.md`. Work shows one child row under the Goal. Julian presses Enter, reads, comments, presses Escape. The row leaves. This record changes none of that. What changes: the worker's design record, rationale, and solution document sit in `records/`, linked from the design. They are one link away in the reader and one dim row down in the Goal reader. They are not on Go To's first screen.

**Journey C, diagnosis.** Julian wants to know why a worker did something. He opens the Goal reader, sees Records after Documents, and opens the rationale. Or he opens Obsidian, expands `records/`, and reads it. Same file, two doors, both visible.

Cost of the pattern. One folder name to learn. One rule to keep: who reads it. Everything else is the product as it is.

### 5.2 Architecture and data

Ownership, one authority per fact:

| Fact | Owner | Where |
|---|---|---|
| Standing Area facts, what is in motion | the brain, Julian | the note |
| A wanted change and its state | Tangent (frontmatter), the brain and workers (State) | `goal-<slug>.md` |
| A durable decision Julian reviews | agents, Julian | `design-<slug>.md` |
| Other reader prose | agents, Julian | any other `.md` in the folder |
| Julian's exact words | Tangent | `journal.md` |
| One-line ideas from a command | `tangent idea add` | `ideas.md` |
| Repeatable work | agents, when Julian asks | `process-<slug>.md` |
| Agents' working material | agents | `records/` |
| A how-to the harness loads | Julian, the brain | `.agents/skills/<name>/SKILL.md` |
| That an agent presented a file | Tangent runtime | `~/.tangent/agent-shell/presented/` |

Invariants.

1. Kind follows from name and place. No file needs a `type:` line for the index to know what it is.
2. `records` and every dot-folder are never Areas. `tangent area create records` is refused like `shared`.
3. Tangent writes into the vault only through its commands: Goal frontmatter, `journal.md`, `ideas.md`, process status lines, the note's environment block, and the instruction links. It never writes into a note's prose or into a Document.
4. A record can link a Goal or a Document, and a Document can link a record. A link carries no rank.
5. The index resolves a symlink by its target before it de-duplicates, so a link never produces a second Document.

Index kinds after this record: `note`, `goal`, `document` with `docKind` `design` or `document`, `journal`, `process`, `record`. Prefix inference and the two-files rule go. `ideas.md` is a `document`.

Why a folder and not a prefix. The flat folder is the problem. A prefix keeps the file in the same list at the same rank. A folder is one collapsed row in Obsidian, one rank rule in Go To, and one line in the index walker.

Why one folder per Area and not one per Goal. A directory is an Area by rule, and a Goal is one file by decision (area-note record D6). 156 Goal folders are the flat folder in a new shape.

### 5.3 Migration and compatibility

Survive: every wikilink, every Goal `## Sources` link, every comment, and the git history of every moved file. Coexist: the rule and the unswept files, for as long as Julian wants. Authority: the folder is the authority from the day the README changes. A `rationale-` file in the Area folder is a Document until it moves, and it harms nothing. Detection: the sweep lists files by retired prefix per Area before it moves them. Rollback: `git mv` back. Runtime records: queue `extraFiles`, Goal `## Sources` links, and presentation records can hold vault-relative paths of moved files. The sweep rewrites the ones it finds and prints the rest. Temporary code: none, because nothing reads the retired prefixes after the change.

The `outcome-*` files stay. They are done Goals under an old name, inert, and a move buys nothing.

### 5.4 API

- `tangent area create <parent> records` and a move onto that name are refused with the existing message.
- `--source` accepts records. `sourceDocuments` reads indexed Documents (`server.mjs:1376`). It accepts `kind: "record"` too, so a brain can hand a worker a rationale.
- `--present` reaches records. The presented-documents design accepts any vault Markdown path. The projection takes the title from the index, so records must be indexed (D12).
- `tangent vault commit` derives its `Tangent-Node` trailer from the first path's directory (`vault.ts:71`, per the skills evidence file). A `records/` path needs the Area walk to stop at the Area folder, the same fix `.agents/skills` paths need.

## 6. Candidate designs

- **C1. The Codex study as written.** Five roles, `.agents/artifacts/`, a Page kind. Loses on the hidden folder and on the extra word.
- **C2. The Claude study as written.** Six kinds, `records/`, ideas folded into the Journal. Loses on the Journal fold.
- **C3. One generic Document, no folders.** Loses because the Area folder is the mess (section 3.1), and because the note, the Journal, and skills have different readers and lifecycles.
- **C4. Keep the prefix taxonomy and add `record-` as a prefix.** Loses because a prefix changes neither rank nor reading surface. Writers also invent prefixes: `review2-`, `review4-`, `map-`, `wrapup-`, `doc-`, `draft-` under `neara`.
- **C5. The synthesis (selected).** C2's placement rule and folder, C1's discipline on ideas and on the Design as the one reviewed kind, both studies' skills layout, and a two-step migration.

## 7. Decisions

**D1. The kinds. Each already exists, or is a folder.**

| Kind | Path | Who writes | Who reads | Tangent reads |
|---|---|---|---|---|
| Area note | `<area>/<name>.md`; `AGENTS.md` and `CLAUDE.md` link to it | the brain, Julian | every agent in the Area, every turn; Julian on the Area page | `status:`, the environment block, the optional `- Repository:` line |
| Goal | `<area>/goal-<slug>.md` | Tangent (frontmatter), the brain and workers (State) | Julian on Work; agents in the prompt | frontmatter |
| Document | `<area>/design-<slug>.md`, or any other name directly in the folder | agents, Julian | Julian | the H1, links, comments |
| Journal | `<area>/journal.md`, `journal-<from>-<to>.md` | Tangent, on "remember this" | the brain when Julian asks to be oriented; Julian in History | marker, time, source |
| Ideas inbox | `<area>/ideas.md` | `tangent idea add` | the brain, which empties it | nothing |
| Process | `<area>/process-<slug>.md` | agents, when Julian asks | Julian on the Area page; the brain when due | frontmatter |
| Records | `<area>/records/*` | agents | agents; Julian when he digs | the H1 and links of `.md` files |
| Skills | `<area>/.agents/skills/<name>/SKILL.md`; `.claude/skills -> ../.agents/skills` | Julian, the brain | the harness in the Area folder; `tangent area show` | `name:`, `description:` |

The vault root adds a real `AGENTS.md` (how to be a brain), `harnesses.md` (the registry), `journal.md` (the Root Journal), and `README.md` (the rules).

**D2. One placement rule.** If Julian is meant to read it, it sits directly in the Area folder. If only agents are, it sits in `records/`. Presentation is separate: a worker can present any vault file, wherever it sits.

**D3. A Document is any reader file. `design-<slug>.md` is the one named Document.** It keeps its prefix for four reasons. It names the one interaction Julian has with documents (read, comment, accept). The worker prompt writes it. The Area map filters it. The Goal reader labels it. There is no Page kind. No other prefix means anything. A reader file with any other name is a Document. It needs no frontmatter and no template. Simple English stays a rule for designs, because they are written for Julian's time. It is not a rule for records.

**D4. `records/` is the agents' folder.** One per Area, created on first write, flat, any file name, any length, no frontmatter, no Simple English. Non-Markdown files go there too. `records` is reserved and never an Area. The index reads its Markdown as `kind: "record"`. What goes in it: design records, solution documents, rationales, results, research, findings, audits, screenshots, worker handovers that want to be Markdown, and a brain's long reasoning. A design record for a Goal goes to the work repository when that repository documents a home for it (this repository: `docs/design/<topic>/`), else to `records/`. Decisive evidence: the walker facts in section 3.3, Obsidian's dot-folder rule, and Julian's Obsidian history.

**D5. No plan file.** `newBrain` stops naming a `planFile`. A brain's memory is the note (ADR-0041 D5). A brain that needs a long file writes one in `records/` under any name and commits it when something changed, not every turn. Existing `plan-<area>.md` files move to `records/` in the sweep. The For Julian reader reads nothing and leaves with the audit window.

**D6. `ideas.md` stays.** As ADR-0041 D6: the inbox of `tangent idea add`, one line each, emptied by the brain into a Goal, a Knowledge line, or the note's Ideas section. It is a Document like any other. It is not a Journal entry, because it is not Julian's complete turn.

**D7. Frontmatter is Tangent's, where Tangent reads it, and nowhere else.** Goals (`type`, `status`, `done_when`, `session`, `verify`, `waiting_on`, `process`), process notes, the note (`status`, `type`, and the environment block), and skill files (`name`, `description`). Documents and records need none. Existing `type:` and `status:` lines on Documents are inert and stay until the file is next edited. The README lists no Document frontmatter.

**D8. Skills are an agent resource.** Canonical `<area>/.agents/skills/<name>/SKILL.md`. Compatibility `<area>/.claude/skills -> ../.agents/skills`, written by the symlink sweep beside the `AGENTS.md` links, never `.claude` itself, because Claude Code writes `settings.local.json` into `.claude/`. Skills are not Documents: no index record, no Go To row, no comments, no map node. `tangent area show` lists every effective skill on the route root to leaf, name and description, once, with its source Area, and the Area page shows the same list. Inheritance is the harness walk from the Area folder up to the vault root, because a brain opens in its Area folder (operating-vision D4). Workers never see Area skills. The brain hands a path in the instruction. `skill-<slug>.md` stays a compatibility input until the unify Goal migrates it. That Goal owns discovery, supply, verification on both harnesses, and duplicate names.

**D9. The Journal is unchanged.** Indexed as `journal`, so Go To opens it read-only, one row per Area. Archives are one link away from its heading.

**D10. Goals are unchanged in kind.** Observed waste in the body (`Current brief` repeats `done_when` in every Goal read. 63 of 168 done Goals under `otto` still say "Not started", per the Claude study) goes to its own Goal.

**D11. Process notes and `harnesses.md` are unchanged.** Documents with a few frontmatter lines Tangent reads. The Area page shows processes in its table (ADR-0043 D4).

**D12. UI status.** The three surfaces that exist keep their jobs. Work: Goals and presented rows, nothing else. The reader: any Document or record, `design` as the one label, comments on vault files. The Area page: the note and its signal line, processes, skills once, Journal capture and History. Four things change. Go To ranks records after Documents and notes under the same search. The Goal reader lists Documents, then records, dimmed. The Area map leaves records out by default and never shows skills. The kind chips become `design`, `document`, `record`. The `page` label and the `KNOWN_KINDS` list go.

**D13. Filing and orientation.** Section 8.

**D14. Migration in two steps.** Step one, the rules: README, root `AGENTS.md`, and the worker prompt sentence. New files land right from that day. Step two, the sweep, per Area, on Julian's word, by Tangent. It moves `design-record-*`, `impl-*`, `rationale-*`, `result-*`, `research-*`, `finding-*`, `audit-*`, `plan-*`, and image files into `records/` with `git mv`. One commit per Area. Runtime paths are rewritten. `threads.md` is deleted. Unprefixed accepted pages, `outcome-*` files, `Untitled.md`, and every `design-*.md` stay.

**D15. Names.** `records` is the folder, because it is the word in the Goal instruction and in the brain's orientation voice. If Julian prefers another word, the rule is one rename. `.agents` is Julian's word for the skills home.

## 8. How a brain files what Julian says, and reads it back

### 8.1 Filing, without a question

Proposed text for the root `AGENTS.md`, under a heading such as "Where things go":

| Julian says | The brain writes | Where |
|---|---|---|
| a wanted change, a bug, a "we should" | `tangent goal create`, parked when he said later | `goal-<slug>.md` |
| a fact agents need every time | one Knowledge line, rewritten in place | the note |
| what is in motion, what matters now, what can wait | Current, at most five lines, in his words | the note |
| a doubt, a priority, a reason | Current, and the Journal when he says "remember this" | the note, `journal.md` |
| a passing thought that is not a Goal | one line under Ideas and open questions | the note |
| who is doing what | free text in the Goal title or in Current | Goal, note |
| a decision that needs alternatives | asks a worker for a design | `design-<slug>.md` |
| the brain's own reasoning or a long analysis | a record, any name | `records/` |

Then one line per thing written. The brain never asks where something goes, and never asks Julian to classify. "Remember this" is the only guarantee of exact words. Everything else is the brain's paraphrase, which is why Current uses his words where it can.

### 8.2 Reading back

When Julian asks to be oriented, the brain reads in this order (it extends the work-briefing order, section 9 there):

1. The Journal in scope, latest first, with later corrections: "You said ...".
2. The note chain, Purpose, Current, Knowledge: "The note says ...".
3. Open Goals, Goals changed since the last remembered turn, milestones, and the records a Goal names: "The records show ...".
4. Designs and Documents the question needs, by link.
5. A record, only when a Goal, the note, or Julian names it. A record's facts are facts. Its opinions are "the worker's read".

Then "My read is ..." for interpretation. Time spent shows attention, not priority.

### 8.3 Inheritance

- Notes: the harness reads the chain root to leaf. A fact lives at the highest Area where it is true for every Area under it (area-note D5).
- Skills: the harness walk from the Area folder to the vault root. Duplicate names: Unknown, owned by the unify Goal.
- Journal: the Root brain reads every Journal. An Area brain reads its subtree and routed entries.
- `harnesses.md` and the environment block: inherited defaults, as today.
- Documents, records, Goals, process notes: never inherited. Deepest node wins. A brain reads a child Area's files only by link or through `tangent goal list`.

## 9. The vault rules as they would read

This block replaces the file-kind lines in the README's "Node notes", "Outcomes", and "Processes and skills" sections. It does not replace the section rules for the note, the Goal frontmatter contract, the Journal rule, or the git rules.

```markdown
## Files

An Area is a folder. Its note is `<name>.md`; `AGENTS.md` and `CLAUDE.md` link to it.
The note is the standing instruction and the present state: Purpose, Knowledge,
Current, Ideas and open questions. Under 100 lines. Rewrite, never append.

A Goal is `goal-<slug>.md`. Tangent writes its frontmatter; agents write its State.

Anything else directly in the Area folder is a Document, and a Document is for Julian.
A design is `design-<slug>.md`, in Simple English, and links its Goal. Any other
Document takes any name that says what it is. No frontmatter is needed.

`journal.md` is what Julian said, word for word. Tangent writes it. Nobody edits it.
`ideas.md` is the one-line inbox of `tangent idea add`. The brain empties it.
`process-<slug>.md` is repeatable work. Tangent reads its frontmatter.

`records/` is for agents: design records, solutions, rationales, results, findings,
screenshots, and a brain's own long notes. Any name, any length, no rules. Link the
Goal. `records` is never an Area.

`.agents/skills/<name>/SKILL.md` is a skill the harness loads. `.claude/skills` links
to it. `tangent area show` lists skills. Skills are not Documents.

If Julian is meant to read it, it sits in the Area folder. If only agents are, it
sits in `records/`. Nothing else decides where a file goes.
```

## 10. Migration of current Otto files

This record moves nothing. The table is what the sweep does.

| Today | After | Why |
|---|---|---|
| `otto/tangent/tangent.md` | unchanged | the note |
| `otto/tangent/goal-*.md`, `outcome-*.md` | unchanged | Goals, old and new names |
| `otto/tangent/design-*.md` (68) | unchanged | Documents Julian reads |
| `otto/tangent/design-record-*.md` (19) | `records/` | engineering records for later workers; zero comments ever |
| `otto/tangent/impl-*.md` (18) | `records/` | written for the brain and implementers; a worker presents one when it matters |
| `otto/tangent/rationale-*.md` (59) | `records/` | written for the study tutor agent |
| `otto/tangent/research-how-humans-learn-code.md` | `records/` | evidence for one design |
| `otto/tangent/plan-tangent.md` | `records/` | a generation log nothing writes any more |
| `otto/tangent/goal-cards-screenshot.png` | `records/` | evidence for one Goal |
| `otto/dnd/impl-*.md`, `rationale-*.md`, `plan-dnd.md`, `audit-*.md`, `finding-*.md`, five screenshots | `records/` | the same rule |
| `otto/dnd/ramp-connection-behavior.md`, `terrain-travel-costs.md`, `explicit-climbing-routes.md`, `flat-terrain-path-kinks.md`, `terrain-and-traversal-work-map.md` | unchanged | accepted pages Julian reads; a `design-` rename is optional and his call |
| `otto/launcher/plan-launcher.md`, `rationale-*.md`, `result-*.md` | `records/` | the same rule |
| `otto/**/skill-<slug>.md` | none exist | the unify Goal migrates any that appear |
| `journal.md` files | unchanged | the Journal |
| `threads.md` at the root | deleted | written by a deleted command |
| `Untitled.md` at the root | unchanged | Julian's own file |

After the sweep, `otto/tangent` holds the note, 182 Goal files, 68 designs, and `records/` with 99 files. `otto/dnd` holds the note, 42 Goal files, 11 designs, 5 pages, and `records/` with 28 files.

## 11. Examples

**One informal turn.** Julian says to the `otto/tangent` brain: "PG&E still matters most, the dashboards can wait. Troy is on the PLDB check. The launcher sleep nag is a bug, not now. I am not sure the study partner idea is worth it. Remember this."

- Tangent saves the complete turn to `otto/tangent/journal.md`.
- The brain rewrites Current: "PG&E first. Dashboards wait. Troy: PLDB check. Study partner: undecided."
- The brain creates `goal-stop-the-launcher-sleep-nag.md`, parked, in `otto/launcher` after proposing the route, or in its own Area with the launcher named.
- The brain answers: "Journal saved. Current rewritten (four lines). Goal created and parked: Stop the launcher sleep nag."

**One Goal's files after work.** Goal `goal-x.md`. The worker writes `design-x.md` in the Area folder, links `[[goal-x]]`, and presents it. It writes `records/design-record-x.md` and `records/rationale-x.md`, linked from the design. Work shows one row: Read, Design x. The Goal reader shows Documents: Design x. Records: design record, rationale, dimmed.

**`otto/tangent` after the sweep.** The note. `goal-*.md` and `outcome-*.md`. `design-*.md`. `journal.md`. `records/`. Nothing else in the folder. Go To's first screen for the Area: the note and designs.

## 12. Simplicity tests

Use these to check the implementation and to refuse additions later. If any answer is no, the addition is wrong.

1. Who-reads test. A writer places a file by asking who reads it.
2. Zero-frontmatter test. A new file with no frontmatter lands in the right kind by name and place alone.
3. One-breath test. Julian names every kind without looking: note, Goal, Document (design), Journal, records, skills.
4. Delete test. Delete every `records/` folder under `otto` and nothing Julian reads changes.
5. Empty-Area test. A folder with only `<name>.md` is a complete Area. No folder exists until something is written into it.
6. Screen test. The rules fit on one screen. Section 9 is the budget.
7. Thirty-day test. A prefix or folder with fewer than three files after thirty days folds into its neighbour. Today `result-`, `research-`, `finding-`, `audit-`, and `skill-` fail it.
8. Note test. `tangent.md` stays under 100 lines with Current under 14 days old for two weeks running. If the note bloats with `records/` available, the rule is wrong, not the brain.
9. Orientation test. After one mixed turn saved with "remember this", a fresh brain restores Julian's view from the Journal, the note, and Goals only. If it needs a record, the record was Knowledge.
10. One-row test. One physical skill makes one row, despite the `.claude` link.
11. Kind-deletion test. Removing a kind changes placement, reader, write rule, lifecycle, or UI. If it changes none, remove the kind.
12. No-new-word test. Every name here is already in Julian's words or in the vault.

## 13. Rejected alternatives

- **`.agents/artifacts/` for agent files** (Codex). Hidden from Obsidian, from every walker, from wikilinks, `--source`, and `--present`. An "agent resources view" to expose it costs the same code as reserving `records/` and gives less.
- **A Page kind** (Codex). Adds a word and no behavior.
- **Folding `ideas.md` into the Journal** (Claude). Breaks the Journal's contract of complete turns in Julian's words. An idea line can be an agent's paraphrase.
- **Keeping the prefix taxonomy** (C4). A prefix changes neither rank nor surface, and writers invent prefixes.
- **One generic Document** (C3). The note, the Journal, and skills have different readers and lifecycles. The flat folder is the problem being solved.
- **Only designs as human documents.** Julian commented seven times in an unprefixed page under `neara`. Reader prose does not need the prefix. It needs the reader.
- **A `type:` line as the authority.** Existing files already disagree with the README, and Julian said "freeform text".
- **One folder per Goal.** A directory is an Area, and a Goal is one file by decision.
- **Agent writing in runtime JSON only.** It cannot be linked, grepped, presented, or handed on.
- **`plan-<area>.md` as a second brain memory.** ADR-0041 gave the memory to the note.
- **Deleting old records or outcomes.** Nothing is deleted except `threads.md`. Git keeps everything anyway.

## 14. Risks, assumptions, and unknowns

- **Assumption:** Obsidian does not show dot-folders in its file explorer or search. This is documented behavior and was not tested here. Test: open the vault in Obsidian and look for `.agents`. If Obsidian shows them, D4 still stands on the walker, wikilink, `--source`, and `--present` facts.
- **Assumption:** Julian accepts rationales one click further away. He opened four in Obsidian recently. Mitigation: a finishing worker presents a rationale when it matters. `records/` is visible in Obsidian.
- **Unknown:** whether a symlinked `<area>/.claude/skills` is followed by Claude Code inside a git repository, and how each harness treats a duplicate skill name on one route. The unify Goal tests both.
- **Unknown:** whether Julian wants `records` renamed. One rename, no rule change.
- **Risk:** `records` as a subject name (`otto/finance/records`). `tangent area create` refuses it with the existing message. The subject takes another name.
- **Risk:** git noise from a brain's record file. `plan-tangent.md` made 392 commits in nine days. The root `AGENTS.md` says: commit a record when something changed, not every turn.
- **Risk:** the `tangent vault commit` trailer for `records/` paths stamps `<area>/records` as the Area until the Area walk stops at the Area folder (section 5.4).
- **Weak evidence:** the Obsidian `lastOpenFiles` list is 36 entries over an unknown period. It shows that Julian opens agent files sometimes. It does not show how often.
- **Reconsider when:** three notes pass 100 lines a month after `records/` exists (the rule failed). Or Julian asks for a standing list of records on Work (contradicts "work only", needs his word). Or a third real case asks for a folder inside `records/` (keep it flat until then). Or Julian's turns filed into Current lose their meaning in the brain's paraphrase (widen the "remember this" cue, his call).

## 15. Implementation boundary

Slices, in order. Each leaves the product working. None is done here.

1. **Rules.** README: the block in section 9 replaces the file-kind lines. The Document frontmatter list goes. `records` joins `shared` as reserved. Root `AGENTS.md`: the filing table (8.1) and the read-back order (8.2) in prose, plus "commit a record when something changed". Worker prompt (`server.mjs:1857`): one added sentence, "Everything else you write goes in `<area>/records/`". `~/.agents/AGENTS.md`: unchanged. Tests: prompt snapshot.
2. **Index.** `records` in `TREE_SKIP` and `RESERVED`. `readAreaRecords`: the Markdown files directly in `<area>/records/` as `kind: "record"`. `INSTRUCTION_LINK_NAMES` replaced by `realpath` de-duplication. `assignKinds` reduced to `design | document | record` by name and place. `KNOWN_KINDS`, the two-files rule, and the `page` label deleted. `journal.md` and `journal-*.md` as `kind: "journal"`. `process-*.md` as `kind: "process"`. `sourceDocuments` accepts records. Go To: records after Documents. Goal reader: Documents, then records dimmed. Area map: records off by default. Tests: index fixture with `records/`, `tangent area create records` refused, Go To order, Goal reader order, symlink de-duplication.
3. **Brain record.** `newBrain` sets no `planFile`. `brainPlanText` returns "" for records without one (it already does). Tests: brain record fixture.
4. **The sweep.** `scripts/vault-records-sweep.mjs`, run once per Area on Julian's word. It lists files by retired prefix and moves them into `records/` with `git mv`. It rewrites queue `extraFiles`, Goal `## Sources` paths, and presentation records that name a moved file. It deletes `threads.md`. It commits `update: <area> move agent records into records/` through the vault commit path with `--area`. Rollback is `git mv` back. Tests: a fixture vault before and after.
5. **Skills.** Owned by `goal-unify-tangent-area-skills-with-agent-skill-disco`. That Goal covers the layout, the `.claude/skills` link in the symlink sweep, the `tangent area show` walk over `.agents/skills` on the Area route, `skill-<slug>.md` compatibility, and the README lines.
6. **Vault commit trailer.** The Area walk for `records/` and `.agents/skills` paths stops at the Area folder.

Out of the boundary: the Goal body (D10), Go To showing Goals, reading state, any change to the Journal contract, Obsidian settings.

## 16. Sources

- Vault: `README.md`, `AGENTS.md`, `otto/**` (all files), `.obsidian/workspace.json`, `.obsidian/app.json`, `.gitignore`, `.agents/skills/remember/`, `neara/delivery/cli/ideas.md`, `neara/pgande/process-rebase-pgande-staging.md`. `git log` on `otto` (authorship, added files by prefix, deleted files).
- Studies: `study-claude.md` (commit `340172e`), `otto/tangent/design-simple-vault-document-ontology.md` (vault commit `e2a26438`).
- Julian's words: `user-intent.md`, `../agent-shell-operating-vision/user-intent.md`, `../area-note-as-system-prompt/design-record.md` section 1, `../agent-shell-work-briefing/design-record.md` section 2, `../agent-shell-presented-documents/user-intent.md`, comment marks in `otto/tangent/design-*.md`.
- Code: `packages/agent-shell/app/server.mjs` (`TREE_SKIP` 535, `readTree` 542, `INSTRUCTION_LINK_NAMES` 678, `readAreaDocuments` 722, `buildVaultIndex` 932, `sourceDocuments` 1376, worker prompt 1857, `newBrain` call 4719, `brainPlanText` 5101, `forJulianItems` 5113, `journal` route 5976), `area-operations.mjs:6,46,59`, `area-brain-domain.mjs:11-95`, `area-skills.mjs`, `public/area-map-core.js:15-61`, `public/go-to-rows.js:26-30`, `public/area-directory-view.js:276-283,336`, `brain-record.mjs:126`.
- Design records: `../area-note-as-system-prompt/design-record.md` (D1 to D9), `../agent-shell-operating-vision/design-record.md` (D4, D20) and `evidence/area-skills.md` (sections 2, 3), `../agent-shell-work-briefing/design-record.md` (sections 8, 9, 12), `../agent-shell-presented-documents/design-record.md` (section 1, D1, D6).
- ADRs: 0020, 0023, 0024, 0033, 0040, 0041, 0043.
- Neighbouring Goal: `otto/tangent/goal-unify-tangent-area-skills-with-agent-skill-disco.md` and its queue record (assignment 1 stopped, assignment 2 running).
- Vault designs: `otto/tangent/design-living-documents.md`, `design-define-tangent-s-ontology.md`, `design-agent-shell-work-briefing.md`, `design-right-document-reading.md` (dropped), `design-agents-present-their-documents.md`.
