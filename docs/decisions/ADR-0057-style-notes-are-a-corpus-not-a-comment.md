# ADR-0057: A style note is a corpus entry, not a Document comment

Status: accepted. Design: `docs/design/style-notes/design-record.md`. Brief: `~/.tangent/trees/otto/tangent/records/style-notes-brief.md`.

## Context

Julian asked for a way to record that a piece of writing is bad without creating work: "i dont need to see these comments but at any time we can use those meta comments (if they still exist) to improve llm writing at a meta level."

Today the only way to record a writing problem is a Document comment, and a Document comment is a task. It shows in the reader, it lists in `tangent document comments`, it can send a brain notice, and it counts as open work.

An inline marker such as `{>>style: ...<<}` looked cheap because the parser accepts the author tag for free, and the copy path already strips it. It is not cheap. The reader strips only the comments in the list it was handed, so a style note either paints an aside or renders its literal markup. Five more surfaces count or list every parsed comment: the Area badge, the worker prompt, the For Julian rows, `GET /api/document/comments`, and the brain notice. An inline marker needs six coordinated suppressions to stay silent, and each one is a place where a later edit brings the nagging back.

An inline marker also dies with the paragraph it annotates, and that paragraph gets rewritten because of the note. The corpus decays exactly as it becomes valuable.

## Decision

A style note writes no vault file and makes no vault commit. It appends one line to `~/.tangent/style-notes.jsonl` (`TANGENT_STYLE_NOTES_FILE` overrides it), schema `tangent.style-note.v1`, beside the other root-level Tangent logs.

Invisibility comes from absence, not from suppression. No comment surface changes, so none can regress. `POST /api/style-notes` is excluded from the POST invalidation path as well, because a style note changes nothing any shell surface shows.

Every entry is a fact at the moment of writing and no field is a live pointer. It carries the observation, free-text tags, the Document path, Area, title and vault `HEAD`, and a snapshot of the annotated words with the line and heading they stood under. The snapshot is what makes the note survive the rewrite it caused.

Provenance is recorded twice and resolved at write time, because Job records get pruned and session names get reused. The observer is the caller. The author is whoever wrote the annotated words, found by `git blame` on the located line, then the `Tangent-Tmux` trailer the vault already writes on every commit, then the durable brain and queue records that name a harness, model, and effort. Every step can fail. When one does, `author.known` is false and `author.source` names the step: `quote-not-found`, `no-blame`, `no-trailer`, or `unknown-session`. Nothing is guessed.

Writers are Julian, in the reader composer, and Area brains, through `tangent style add`. `/api/style-notes` joins `WORKER_REFUSED_ROUTES`, so "workers only send" (ADR-0040) stays visible on this route rather than implied. A worker that notices bad writing tells its brain, as it already does for everything else.

The corpus is read back with `tangent style list [--json]`, which groups and counts by model, harness, tag, and Area. That is the deterministic half. A model then reads the notes and drafts writing rules, and Julian applies what he agrees with. Nothing auto-edits a context file. Distilled house rules belong in the "Writing Style" section of `~/.claude/CLAUDE.md`, not in the simple-english skill, which carries an external standard.

This does not extend `~/.claude/corrections.jsonl`. That file lives inside one harness profile, and the corpus must record which harness wrote badly, including harnesses that are not Claude. Its fields record a task misunderstanding anchored to a conversation, not prose quality anchored to a stretch of text.

## Consequences

The 89 existing `{>>Julian: ...<<}` comments keep their author, anchor, listing, numbering, and resolve path. `parseComments` is unchanged.

A style note is not readable in the raw Markdown. The only reader who would look for it there is the one person who asked never to see it.

The corpus is append only. No command edits or removes a line, because an entry is a record of a moment. A rewrite of the annotated text does not touch it. A rename leaves `document.file` stale and nothing repairs it; a harvest treats a missing file as a fact. A deleted Document leaves the entry whole.

The vocabulary of writing problems is free text in v1. The corpus has to demonstrate its categories before any of them are fixed.

If the corpus stays thin and the thinness traces to brains not relaying what workers noticed, the decision to keep workers out reopens. If Julian asks to see a style note in the raw Markdown, the six suppression surfaces named above are the exact price.
