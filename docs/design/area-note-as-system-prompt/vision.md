# The Area note as system prompt

For Julian. Date: 2026-08-27, revised after your answers. Full reasoning and evidence: `design-record.md` beside this file.

## The idea in one paragraph

Each Area's main note is its `AGENTS.md`. Two symlinks per folder make it so: `AGENTS.md -> <name>.md` and `CLAUDE.md -> AGENTS.md`. The vault root gets a real `AGENTS.md` that says how to be a brain. A brain opens in its Area folder and the harness reads the chain itself, root first. Tangent sends no brain prompt. Tested tonight: claude, codex, and pi each read a symlinked root note and leaf note in one go.

## What the survey found

29 Areas have a note, 6 have none. `otto/tangent` is 263 lines: 138 Goal links, 33 appended ideas, 60 lines of prose. Only 9 notes have a `Current`, and the longest still describes 2026-08-16. Commits on the tangent note: 148 `add`, 12 `update`. The README rules are right. Nobody obeys them. Every line now costs context on every turn, and codex caps the chain at 32 KiB.

## The template

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

## The rule per section

| Section | Rule |
|---|---|
| Purpose | What this Area is and what done looks like. One to three lines. |
| Knowledge | What an agent needs every time. Repos, branches, commands, links, conventions. One line each. A procedure is a `skill-<slug>.md`. A big topic is a Document. |
| Current | What is in motion now. Five lines, present tense, no dates. Rewrite, never append. Name Goals with links. |
| Ideas and open questions | Thoughts not yet a Goal, by hand. Ten lines at most. A bug is a Goal, not an idea. |
| Development environment | The UI writes it. Leave it. |

No `Resources` section. The brain reads the folder from Knowledge and passes `--path`. Nothing checks the folder before a start. An Area with two repositories lists both. A fact lives at the highest Area where it is true for every Area under it. A child never repeats a parent line.

## What changes

1. A sweep writes the two symlinks in every Area folder. It never replaces a real file. It runs at server start and on Area create.
2. The vault root gets the real `AGENTS.md`. Tangent stops generating a brain prompt. Your first message still starts the brain.
3. `## Resources` goes. The brain moves its lines under Knowledge on its next edit. The `- Repository:` parser stays as an optional shortcut.
4. README gets the table above and four edit rules. Rewrite, do not append. Harvest, then delete. Keep the note under 100 lines. No dates, no bug reports.
5. Work shows one dim line per Area: `<n> lines · Current <d> days old`. Warning color past 100 lines or 14 days.
6. A brain or Goal start on an Area with no note writes the template first.
7. Tangent never writes into a note. `## Goals` goes: a Goal is its `goal-<slug>.md` file, and Work orders by status then creation time. `tangent idea add` writes to `<area>/ideas.md`. The brain empties it into Goals or Knowledge.
8. README: sections are Purpose, Knowledge, Current, Ideas and open questions. Road to done and its ordering rule go.

## Your word is still needed on

1. The UI writes the `tangent.environment.v1` block into the note on your click. Keep that one exception, or move it to `environment.md`? Recommended: keep it.

## Not verified

agy, opencode, and the gateway harnesses were not tested with the symlink chain. Obsidian's view of the symlinks was not tested.
