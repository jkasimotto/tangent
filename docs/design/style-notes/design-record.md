# Style notes that never nag: design record

Date: 2026-09-02. Status: designed, not implemented. Branch: `dev/style-notes`.

Goal: `~/.tangent/trees/otto/tangent/goal-leave-writing-style-notes-that-never-nag.md`.
Brief with Julian's exact words: `~/.tangent/trees/otto/tangent/records/style-notes-brief.md`.

Lenses: architecture, types and data (a new store, its owner, and its invariants), API (a new CLI noun, a new HTTP route, and the worker refusal rule), migration and compatibility (89 existing comments must keep their meaning), operations (what fails, and how it fails).

Facts carry a label: Observed, Decision, Assumption, Proposed generalization, or Unknown. Repository line numbers are as read on 2026-09-02 in this worktree and will drift. Vault paths are relative to `~/.tangent/trees`.

## 1. Problem contract

**Root problem.** Julian wants to record that a piece of writing is bad without creating work. His words: "give me a way to meta comment on documents about writing style. i dont need to see these comments but at any time we can use those meta comments (if they still exist) to improve llm writing at a meta level."

The blocked outcome is at the meta level. Today the only way to record a writing problem is a Document comment, and a Document comment is a task. It shows in the reader, it lists in `tangent document comments`, it can send a brain notice, and it counts as open work. So the observation that "this model writes buried sentences" either becomes a chore or is never recorded.

**Three properties that define success**, from the brief:

1. Invisible. The note never appears in the reading view, never lists as a comment, never sends a notice, and never counts as open work. A style note that nags is a failure, not a partial success.
2. Durable past its document. The note survives the rewrite of the text it annotates. The rewrite is often caused by the note itself.
3. Harvestable. The whole corpus can be read back and turned into concrete writing rules.

**Constraints.**

- The 89 existing `{>>Julian: ...<<}` comments keep their meaning and their behavior.
- Workers only send (ADR-0040, `server.mjs:5094`). The operating philosophy is notes, not machinery.
- Nothing auto-edits a context file. A human confirms every rule that lands in `CLAUDE.md` or a skill.
- No new invented terms. "Style note" uses Julian's own word, "meta comment on documents about writing style".
- Imperfect and partial is acceptable. Silently wrong is not.

**Non-goals.** A grading system for prose. A score per model. A linter. Automatic edits to any document. A vocabulary of style problems fixed before the corpus exists. Chasing a document across a rename.

## 2. What the code does today

Every claim in this section was read or run in this worktree.

### 2.1 The comment parser accepts a `style` author for free

Observed. `splitAuthor` (`packages/agent-shell/app/public/document-comments.js:33`) splits a comment body with the regular expression `^([A-Za-z][\w .-]{0,40}?):\s+([\s\S]*)$`. The word `style` matches. Run against a real document body, `parseComments` returns `author: "style"` with the anchor quote intact:

```
input:  The {==passive voice sentence==}{>>style: buried lede, three clauses<<} here.
output: { author: "style", text: "buried lede, three clauses", quote: "passive voice sentence", ... }
```

Observed. A `#` in the tag does not parse. The author pattern allows only `[\w .-]`, so a back reference such as `{>>style#a1b2: ...<<}` falls back to author `""` and keeps the whole string as text.

### 2.2 The copy and export path strips a style note for free

Observed. `cleanInlineSource` (`packages/agent-shell/app/public/document-copy.js:11`) removes `{>>...<<}`, `{==` and `==}` by token, with no author test. Run on the same input, `cleanDocumentMarkdown` returns `"# T\n\nThe passive voice sentence here."`.

### 2.3 The reader does not strip a style note for free

Observed. This is the finding that decides the design. `markdownToHtml` in `packages/agent-shell/app/public/shell.js` removes comment markup with `stripComments` (`shell.js:246`). That function reads `documentComments.commentTokensOnLine(comments, fileLine)`, where `comments` is the list the caller passed in. It removes only the token ranges of the comments in that list.

Two outcomes follow, and both are wrong:

- Keep style notes in the list. `tailFor` (`shell.js:240`) renders an aside for every comment through `commentAsideHtml` (`shell.js:367`), and `stripComments` paints a `<mark>` around the anchor (`shell.js:358`). The note is visible. Property 1 fails.
- Remove style notes from the list. Their token ranges are no longer removed. The literal text `{>>style: buried lede<<}` renders in the reading column. Property 1 fails harder.

Either outcome needs a code change. The claim in the brief that a distinct author tag inherits the stripping behavior for free is true for copy and export, and false for the reader.

### 2.4 Five more surfaces count or list every comment

Observed. `parseComments(text).length` is the count in three places, and each feeds a surface Julian sees:

| Surface | Source | What Julian sees |
|---|---|---|
| Area page badge | `server.mjs:962` | "N comments" on a Document row |
| Worker prompt | `server.mjs:2090`, `2178`, `2180` | "(N open comments from Julian)" and a paragraph telling the worker to carry them along |
| For Julian rows | `server.mjs:6436`, `public/ask-core.js:143` | "N comments left" |

Observed. Two more paths read the parsed list itself:

- `GET /api/document/comments` (`document-routes.mjs:12`) returns `document.comments` verbatim from `readVaultDocument` (`server.mjs:973`). The CLI prints every entry. A style note would list.
- `notifyBrainOfDocumentComments` (`server.mjs:1053`) refuses when the list is empty and otherwise sends a brain notice with the count. A document holding only style notes would let the notice fire.
- `resolveVaultDocumentComment` (`server.mjs:1067`) matches by text prefix across the whole parsed list. `tangent document resolve` could remove a style note by accident, and its "remaining" count would include style notes.

Observed. `parseComments` numbers comments by position across the whole document. `tangent document comments` prints `comment.index + 1` and `tangent document resolve --index` reads it back (`src/cli/commands/document.ts:43`, `:52`). Hiding entries from the list makes the printed numbers non-contiguous or wrong.

Count: an inline marker needs six coordinated suppressions to stay silent. The reader, the Area badge, the worker prompt, the For Julian rows, the comments listing, and the notice. Each one is a place where a later edit brings the nagging back.

### 2.5 Vault commits already carry the session that wrote the text

Observed. `commit` in `packages/agent-shell/app/vault-repository.mjs:32` writes two trailers on every vault commit:

```
Tangent-Area: <area>
Tangent-Tmux: <tmux session>
```

Observed in real history. `git log` in `~/.tangent/trees` shows `Tangent-Area: otto/dnd/events/records` and `Tangent-Tmux: dnd-brain-g22` on recent commits. `tangent vault commit` writes the same trailers (`src/cli/commands/vault.ts:46`, `:48`).

Observed. Reading those trailers back is already done. `area-map.mjs:146` reads `--format=...%(trailers:key=Tangent-Tmux,valueonly,...)` to attribute vault commits to sessions.

Observed. The session save path does not pass a session. `saveVaultDocument` calls `writeVaultDocument(current, text, message)` with no fourth argument (`server.mjs:1044`), so a document Julian edits in the reader commits without a `Tangent-Tmux` trailer.

### 2.6 A session name resolves to a harness, model, and effort

Observed. `agent-context.mjs` maps one session name to its work record. `assignmentContext` returns `assignment.launch` and `assignment.launchDisclosure` (`agent-context.mjs:161`, `:162`). A launch is `{ harness, model, effort }` (`job-record.mjs:609-613`). The disclosure adds the resolved command and the moment it was settled (`server.mjs:3350`).

Observed. A brain generation carries `resolvedLaunch` with the same shape (`brain-record.mjs:217-220`, projected at `agent-context.mjs:102`).

Observed. Job records live at `~/.tangent/agent-shell/pipelines/<area>/<slug>.json` (`server.mjs:297`, `job-record.mjs:42`). Brain records live at `~/.tangent/agent-shell/brains` (`server.mjs:344`).

So the server, and only the server, can turn a session name into a harness, a model, and an effort. A CLI that did this itself would duplicate that authority.

### 2.7 Workers are refused every mutation

Observed. `WORKER_REFUSED_ROUTES` (`server.mjs:5094`) holds 64 routes, `/api/document` and `/api/document/resolve` among them. `refuseWorkerMutation` (`server.mjs:5128`) reads the `x-tangent-session` header, resolves the caller with `commandProvenance`, and returns "workers only send" for a worker.

Observed. `~/.agents/AGENTS.md` states the same rule in Julian's words: "A worker talks to its brain in plain words and runs no other Tangent command."

### 2.8 The sibling corpus

Observed. `~/.claude/corrections.jsonl` holds 7 lines. Fields: `date`, `conversation_id`, `mistake`, `missing_context`, `resolution`. Every entry is about a task misunderstanding, such as missing a `plz test` command or chasing the wrong performance hypothesis. No entry is about prose.

Observed. `~/.tangent/` already holds append-only JSONL logs at its root: `feedback.jsonl`, `feedback-triage.jsonl`, `worklog.jsonl`, `agent-shell-messages.jsonl`, `agent-shell-actions.jsonl`.

## 3. Candidate designs

### A. Inline marker only

`{>>style: ...<<}` in the Markdown, nothing else.

Fails property 2 outright. The note dies with the paragraph it annotates, and the paragraph is rewritten because of the note. Fails property 1 until all six suppressions in section 2.4 are built. Rejected.

### B. Inline marker as source of truth, corpus as a mirror

The marker is written first. A sweep copies it into a corpus.

Keeps every cost of A. Adds a synchronization problem: a document edited outside Tangent changes the source of truth without telling the corpus. Two writers, one fact. Rejected.

### C. Corpus as source of truth, inline marker optional

Every note appends one corpus entry. A flag also writes a marker.

The optional marker still has to be correct when it is used, so it still pays all six suppressions. The brief allows partial work but not silently wrong work. An optional path that nags in one of six surfaces is silently wrong. Rejected in its optional-marker half, adopted in its corpus half.

### D. Corpus only. No document is written

The note is captured against a Document but stored outside it.

Property 1 holds by construction, not by suppression. Nothing enters the file, so the reader, the badge, the prompt, the For Julian rows, the listing, and the notice need no change and cannot regress. Property 2 holds because the entry carries a snapshot of the annotated text. Property 3 holds because one file holds the whole corpus.

Adopted.

## 4. Decisions

**D1. The corpus is the only store. A style note writes no vault file and makes no vault commit.**

Decisive evidence: section 2.3 and 2.4. Invisibility that rests on six coordinated suppressions is fragile. Invisibility that rests on absence cannot regress. The cost is that a style note is not readable in the raw Markdown, and the only reader who would see it there is the one person who asked never to see it.

**D2. The corpus is `~/.tangent/style-notes.jsonl`, append only, one JSON object per line.**

It follows the existing root-level JSONL pattern (section 2.8). The path is overridable with `TANGENT_STYLE_NOTES_FILE`, in the same style as `TREES_ROOT`, `TANGENT_PIPELINES_ROOT` and `TANGENT_BRAINS_ROOT` (`server.mjs:223`, `:297`, `:344`), so tests never touch the real corpus.

**D3. This does not extend `~/.claude/corrections.jsonl`. It is a separate file.**

Four reasons, in order of weight:

1. Ownership. `~/.claude/` is one harness profile. The corpus must record which harness wrote badly, including harnesses that are not Claude. A harness-neutral corpus inside one harness's profile directory is wrong.
2. Subject. `corrections.jsonl` records a task misunderstanding, with fields `mistake`, `missing_context`, `resolution`. A style note records prose quality with a text snapshot. No field maps.
3. Anchor. A correction is anchored to a conversation (`conversation_id`). A style note is anchored to a Document and a stretch of text.
4. Destination. A correction improves project knowledge and memory. A style note improves writing rules.

The two stay siblings. The design record names the relation so nobody merges them later by accident.

**D4. The writers are Julian and Area brains. A worker relays through `tangent send`.**

A new verb for workers would break "workers only send", which is settled and one of the few rules Julian holds in his head. The value of the corpus does not depend on who files the note, because the provenance of the bad writing comes from the git trailer (D7), not from the filer. A worker that notices bad writing says so in its note to the brain, as it already does for everything else.

Condition to reopen: if the corpus stays thin after a month of use, and the thinness traces to brains not relaying, grant workers the one verb and add `/api/style-notes` to nothing.

**D5. Until then, `/api/style-notes` joins `WORKER_REFUSED_ROUTES`.** A worker that tries it gets the standard refusal, so the rule stays visible rather than implied.

**D6. One new CLI noun, `tangent style`, with `add`, `list`, and `show`.**

Not under `tangent document`. That command declares itself as "the agent's lane for Julian's comments inside a vault Document" (`src/cli/commands/document.ts:9-13`), and it writes the vault. A style note writes no vault file and its reading commands are corpus wide, not per document. Two homes for one subject would be worse than one new noun.

Registration follows the existing path: a spec in `packages/agent-shell/src/cli/spec.ts`, a command module beside `document.ts`, an export in `src/cli/index.ts`, and three entries in `src/cli/index.ts` (the command map at line 29, the help list at line 67, and the group at line 196).

**D7. Provenance is recorded twice: the observer and the author of the annotated text.**

The observer is the session that filed the note. The server resolves it from the `x-tangent-session` header through the same path as `commandProvenance`, then through `agent-context` to `launch` or `resolvedLaunch` (section 2.6).

The author is who wrote the bad sentence, and that is the fact worth having. The server resolves it best effort:

1. Find the annotated line in the file on disk.
2. `git blame -L <line>,<line> --porcelain` in `~/.tangent/trees` gives the commit.
3. `git show -s --format=%(trailers:key=Tangent-Tmux,valueonly)` gives the session (section 2.5).
4. The session resolves to a harness, model, and effort (section 2.6).

Any step can fail. When it fails, the entry records `author.known: false` and the reason. The design never guesses an author.

**D8. Provenance is resolved when the note is written, not when it is read.**

A Job record can be pruned and a session name can be reused. The mapping is reliable while the session is current, so the write path captures it. This also keeps the corpus self contained, which property 2 requires.

**D9. Style problem tags are free text with no controlled vocabulary in v1.**

The vocabulary of writing problems should come out of the corpus, not be invented before it. This follows the same rule the rest of Tangent follows: describe demonstrated variation, never imagined variation.

**D10. Distillation is a read plus a model, never an automatic edit.**

`tangent style list --json` is the deterministic half. It groups and counts. A skill or a process note reads it and drafts rules. The draft lands as a proposal in `otto/tangent`, and Julian applies it.

**D11. The distilled rules land in the "Writing Style" section of `~/.claude/CLAUDE.md`.**

Not in `~/.agents/skills/simple-english/SKILL.md`. That skill carries ASD-STE100, an external standard with fixed rules. House rules mixed into a standard corrupt both. `CLAUDE.md` already holds Julian's own writing rules, such as the em dash rule and the commit wrapping rule.

## 5. The record shape

Schema `tangent.style-note.v1`. One line per note.

```json
{
  "schema": "tangent.style-note.v1",
  "id": "0f3a...",
  "at": "2026-09-02T21:14:07.221Z",
  "note": "Three clauses before the subject. The point is at the end.",
  "tags": ["buried-lede"],
  "document": {
    "file": "otto/tangent/design-scene-generation.md",
    "area": "otto/tangent",
    "title": "Scene generation",
    "vaultCommit": "33b5efb29dc7707f118091e6214e51275185f51d"
  },
  "quote": {
    "text": "Because the pipeline resolves each anchor before the render pass begins, the scene is stable.",
    "line": 42,
    "heading": "Rendering"
  },
  "author": {
    "known": true,
    "source": "blame-trailer",
    "commit": "9c1e...",
    "session": "tangent-scene-2",
    "harness": "claude-otto",
    "model": "opus-5",
    "effort": "high"
  },
  "observer": {
    "kind": "brain",
    "session": "tangent-brain-g44",
    "area": "otto/tangent",
    "harness": "claude-otto",
    "model": "opus-5",
    "effort": "high"
  }
}
```

Field rules:

- `note` is required, one line, capped at 1000 characters.
- `quote` is null for a whole-document observation. `quote.text` is the snapshot that makes the note survive the rewrite. It is capped at 2000 characters and is stored exactly as the reader showed it.
- `quote.line` and `quote.heading` are locators at the moment of writing. They are never repaired later.
- `document.vaultCommit` is the vault `HEAD` when the note was written, so a harvest can read the exact text back out of git.
- `author.source` is one of `blame-trailer`, `no-trailer`, `quote-not-found`, `unknown-session`. It says why an unknown author is unknown.
- `observer.kind` is `julian` or `brain`. A `julian` observer has no harness fields.

Every field is a fact at the moment of writing. No field is a live pointer.

## 6. How a note is written

Two surfaces, one route.

**Julian, in the reader.** He selects words. The selection button already exists and already resolves a quote through `visibleLine` (`document-comments.js`), which is the projection the composer uses today. The composer gains one choice: a comment, or a style note. A style note posts to `/api/style-notes` and closes. The document is not saved and no comment markup is inserted.

**A brain, from a shell.**

```
tangent style add otto/tangent/design-scene-generation.md \
  --note "Three clauses before the subject." \
  --quote "Because the pipeline resolves each anchor" \
  --tag buried-lede
```

`--quote` is optional. When it is given, the server finds it in the file on disk to get the line for blame. When it is absent or not found, the note is still written, with `quote.line: null` and `author.source: "quote-not-found"`.

**The route.** `POST /api/style-notes` does five things in order:

1. Resolves the file inside the vault with `safeMarkdownPath`, the same guard `readVaultDocument` uses.
2. Reads the current text and finds the quote.
3. Resolves the observer from `x-tangent-session`.
4. Resolves the author by blame, best effort.
5. Appends one line to the corpus.

The route makes no vault commit, sends no brain notice, and touches no Job record.

## 7. How the corpus is read

```
tangent style list [--area <area>] [--file <file>] [--since <date>] [--model <model>] [--json]
tangent style show <id>
```

`list` reads the file, skips lines it cannot parse, and reports how many it skipped. `--json` returns the entries plus counts grouped by model, by harness, by tag, and by area. Those counts are the deterministic half of D10.

Distillation, run on demand:

1. `tangent style list --json` gives the corpus with its counts.
2. A model reads the notes and the quoted text and drafts writing rules.
3. The draft lands as `otto/tangent/design-<slug>.md`, or as a proposal beside the "Writing Style" section it targets.
4. Julian applies what he agrees with.

## 8. Rewrite, move, and delete

| Event | Effect on the note | Why |
|---|---|---|
| The annotated text is rewritten | None. The note keeps `quote.text` and `document.vaultCommit`. | This is the case Julian's "if they still exist" worried about. The snapshot is the answer. |
| The document is renamed or moved | `document.file` becomes stale. Nothing is repaired. | The path is a fact at the moment of writing. Following a rename would make the corpus a live index, which it is not. A harvest treats a missing file as a fact, not an error. |
| The document is deleted | The note survives whole. | Same reason. `document.vaultCommit` still reads the text back out of git. |
| The vault history is rewritten | `document.vaultCommit` and `author.commit` stop resolving. `quote.text` still holds. | Accepted. The snapshot is the load-bearing field. |

Nothing in this table needs code. It follows from D1 and from the record shape.

## 9. Invariants

1. The corpus is append only. No command edits or removes a line. A note that turns out to be wrong stays, because it is a record of a moment.
2. A style note writes no file under `~/.tangent/trees` and makes no vault commit.
3. A style note produces no brain notice, no Goal, no For Julian row, and no change to any comment count.
4. Every entry is self contained. It stays readable after the document is gone.
5. Provenance is recorded or explicitly null with a reason. It is never inferred.
6. `parseComments` behavior is unchanged. All 89 existing comments keep their author, their anchor, their listing, and their resolve path.

## 10. Failure modes

| Failure | Behavior | Reason |
|---|---|---|
| The Agent Shell server is not running | The command fails and prints the connection error. Nothing is written. | Fail closed. A dropped note is worse than a failed command, because the caller cannot tell. |
| The quote is not found in the file | The note is written. `quote.line` is null. `author.source` is `quote-not-found`. | The observation is worth more than the anchor. |
| `git blame` gives a commit with no `Tangent-Tmux` trailer | `author.known` is false, `author.source` is `no-trailer`. | Expected for anything Julian edited in the reader (section 2.5). |
| The blamed session has no Job or brain record | `author.known` is false, `author.source` is `unknown-session`. | Records are pruned. Guessing would poison the corpus. |
| Two writers append at the same time | Both lines land. | One `appendFile` call in append mode writes one line. The caps on `note` and `quote.text` keep a line small, which makes an interleaved write very unlikely. Not guaranteed by the file system. |
| A corrupt line is in the corpus | `list` skips it and reports the count. | An append-only log must survive one bad line. |
| The corpus file does not exist | `list` returns an empty result. `add` creates the file. | First run must work. |

## 11. Rollout and rollback

Rollout is one release with no migration. The corpus file does not exist yet, so there is no data to convert and no compatibility window.

Order of work:

1. The corpus module: append, read, cap, and skip corrupt lines. Pure, no HTTP, testable alone.
2. Provenance resolution: session to launch, and blame to session. Pure functions plus one git read.
3. `POST /api/style-notes` and the entry in `WORKER_REFUSED_ROUTES`.
4. `tangent style` and its four registration points.
5. The reader composer choice.

Steps 1 to 4 deliver the whole contract for brains. Step 5 is Julian's surface and is the only browser work.

Rollback is a revert. The route, the CLI, and the composer choice come out. The JSONL file is inert, because nothing else in the repository reads it.

## 12. Proof boundary

Must be proven:

- One `tangent style add` appends exactly one parsable line with the resolved observer and author.
- A worker session is refused with the standard refusal.
- After a style note is written, `git status` in the vault is unchanged and no new commit exists.
- After a style note is written, `tangent document comments <file>` prints the same list as before, with the same numbering.
- After a style note is written, the Area badge count, the worker prompt text, and the For Julian rows are unchanged.
- No brain notice is sent, and no message reaches the messages log.
- With the quote missing from the file, the note is still written and says why the author is unknown.
- With a commit that has no `Tangent-Tmux` trailer, `author.source` is `no-trailer`.
- `list` skips a corrupt line and reports the count.
- The reader gesture writes a corpus entry and does not save the document.

Not proven here:

- That the distilled rules improve agent writing. That is judged by a human over months.
- That the free-text tags converge on a useful vocabulary (D9). The corpus is the experiment.
- That brains relay worker observations often enough (D4). Named as the condition that reopens the worker verb.

## 13. Assumptions, weak points, and what would reopen a decision

- Assumption. Julian will file most style notes from the reader, because that is where he reads prose. If he files them from a shell instead, the CLI is already the same route and nothing changes.
- Assumption. `git blame` on the annotated line names the commit that wrote that sentence. It is wrong when a later commit reflowed the line without changing the words. Accepted as best effort, and `author.source` makes it auditable.
- Unknown. How many vault documents were written by an identifiable agent session. `saveVaultDocument` writes no trailer (section 2.5), so the share of `no-trailer` authors could be high. If it is high, the fix is to pass the session into `saveVaultDocument`, which is a one-line change worth making anyway.
- Proposed generalization. Every fact worth harvesting later needs its provenance captured at write time, because records are pruned and names are reused. This design applies it. Job records and brain generations already do the same.
- What reopens D1. Julian asking to see a style note in the raw Markdown. Section 2.4 is then the exact change surface, and its six items are the price.

## 14. Rejected alternatives, in one line each

| Alternative | Why it lost |
|---|---|
| Inline `{>>style: ...<<}` only | Dies with the paragraph. Property 2 fails. |
| Inline as source of truth, corpus as mirror | Two writers for one fact, and an external edit desynchronizes them. |
| Inline optional behind a flag | An optional path still pays all six suppressions or is silently wrong. |
| Extend `~/.claude/corrections.jsonl` | A harness-neutral corpus cannot live inside one harness's profile. Wrong fields, wrong anchor, wrong destination. |
| A `tangent document style` subcommand | `tangent document` is the vault comment lane. Harvesting is corpus wide, not per document. |
| Grant workers a style-note verb | Breaks "workers only send" for a gain the git trailer already provides. |
| A fixed vocabulary of style problems | Imagined variation. The corpus has to demonstrate the categories first. |
| Automatic edits to `CLAUDE.md` or the simple-english skill | Nothing auto-edits a context file. And a standard must not carry house rules. |

## 15. Change surface for implementation

| File | Change |
|---|---|
| `packages/agent-shell/app/style-notes.mjs` | New. Corpus append and read. Pure. |
| `packages/agent-shell/app/style-note-provenance.mjs` | New. Session to launch, blame to session. |
| `packages/agent-shell/app/style-note-routes.mjs` | New. `POST /api/style-notes`, `GET /api/style-notes`. |
| `packages/agent-shell/app/server.mjs` | Wire the routes. Add the corpus path constant beside line 297. Add `/api/style-notes` to `WORKER_REFUSED_ROUTES` at line 5094. |
| `packages/agent-shell/src/cli/commands/style.ts` | New. `add`, `list`, `show`. |
| `packages/agent-shell/src/cli/spec.ts` | New `styleCommandSpec`. |
| `packages/agent-shell/src/cli/index.ts` | Export `runStyleCli`. |
| `src/cli/index.ts` | Command map at line 29, help list at line 67, group at line 196. |
| `packages/agent-shell/app/public/document-reader-controller.js` | The composer choice between a comment and a style note. |
| `packages/agent-shell/app/public/shell.js` | The composer control for that choice. |
| `CLAUDE.md`, `~/.agents/AGENTS.md` | Name `tangent style` in the brain command list. |

No file listed in section 2.3 or 2.4 changes. That is the point of D1.
