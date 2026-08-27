# ADR-0041: Everything starts through the brain

Date: 2026-08-27

Status: accepted. Supersedes the brain handover, pacing, and completion clauses of ADR-0023, ADR-0024, ADR-0028, ADR-0034, and ADR-0037. Design: `docs/design/agent-shell-operating-vision/design-record.md`, D8 to D15 and D24, and `docs/design/area-note-as-system-prompt/design-record.md`.

## Context

Julian's rule for Tangent: "tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli."

The brain contract had grown machinery around that rule. Tangent generated an 8,000-character prompt for each brain attempt. A brain handed over to a fresh copy of itself, and pacing held a waiting brain asleep. A designated review closed a Goal without the brain. Tangent wrote Goal links and idea lines into the Area note. The New Goal form and the Launch Editor started work beside the brain.

## Decision

1. Everything starts through the brain. `a` on an Area in Work opens a plain composer. `⌘↵` sends the message to that Area's brain. When no brain runs, one starts with the message as its first message. The New Goal form and the Launch Editor on the create path are gone. `tangent goal create` for a non-brain caller creates the Goal file and starts nothing.
2. The brain's one command to create and start is `tangent goal create --area <a> --title "<t>" [--done-when "<d>"] --start --path <dir> [--launch <ref>] [--verify] [--instruction "<i>" | --instruction-file <file>]`. The done condition defaults to the title. `--path` says where the worker runs. A brain that names no `--launch` lends its own harness.
3. The brain marks Goals done. When a worker sends `--done`, the brain reads the note, then runs `tangent goal done <slug>` or appends a review step. `completionPolicy`, `designatedReview`, and the review-only closure rule are gone. Old queue records keep the fields and nothing reads them.
4. No brain handover, no rotation. `tangent brain handover`, the handover operation, pacing, the 429 refusal, the 90-minute reminder, and `wakeFromPaceText` are gone. A brain runs until Julian restarts it. `record.checkpoint` stays readable.
5. The Area note is the brain's instruction file. Each Area folder has `AGENTS.md -> <dirname>.md` and `CLAUDE.md -> AGENTS.md`. The vault root has a real `AGENTS.md` that says how to be a brain, with `CLAUDE.md -> AGENTS.md`. A brain opens in its Area folder and the harness reads the chain itself. Claude Code, Codex, and pi each read a symlinked root note and leaf note in one go (area-note-as-system-prompt design record, section 3.6). Codex caps the chain at 32 KiB, so note size matters. Tangent generates no prompt: the first message is Julian's own words, or `Start.` when there are none.
6. Tangent never writes into an Area note. The `## Goals` list and the `- Idea:` lines are gone. `tangent idea add` writes to `<area>/ideas.md`. A Goal is only its `goal-<slug>.md` file. Work orders Goals by status, then creation time. A Subgoal keeps its place inside its parent. An Area with no note gets the template: Purpose, Knowledge, Current, Ideas and open questions. The Area page shows `<n> lines · Current <d> days old`, in warning color past 100 lines or 14 days.
7. Julian flags what he checks. Goal frontmatter gains `verify: yes`, set by `x` on the row or by `--verify` when Julian said so in his message. A brain's `tangent goal done` on a flagged Goal sets status `verify`, shown as `Check it`, clears `session`, and writes the brain's note into `## State`. Only Julian's own Done marks it `done`. `WRITABLE_GOAL_STATUSES` excludes `verify`. The reconcilers skip it.
8. One notification. `julian-notify.mjs` runs `terminal-notifier` once when a Goal enters `verify`, with `-open http://127.0.0.1:4321/?goal=<file>` and never `-ignoreDnD`. It is removed when the Goal leaves `verify`. `verifyNotifiedAt` on the queue record makes it once per entry. A missing `terminal-notifier` logs once.
9. Brain questions do not notify. A brain cannot create a `kind: test` request: the server answers `Julian flags what he checks.`
10. `tangent help` groups commands as Brains, Workers, and Julian. Removed commands are gone from help. `tangent handover` and `tangent goal handover` stay as hidden aliases that say what replaced them.

## Consequences

- `brain-pacing.mjs`, `brain-command-reference.mjs`, and the prompt builders in `area-brain-domain.mjs` are deleted with their tests.
- The brain record keeps `checkpoint`, `handover`, and `waitingStreak` readable from old records. Nothing writes them.
- The vault README lists the note sections, the ordering rule, and the resources rule: resources are free text under Knowledge, and `- Repository:` is an optional shortcut.
- `~/.agents/AGENTS.md` says brains run until Julian restarts them and the Area note is the brain's memory.
- D24, one delivery engine, is not part of this change. Notes to a brain that is not live wait in its inbox. Messages to a live session go through `message-queue.json`. The in-memory set of notices on their way stays until a later slice.
