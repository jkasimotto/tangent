# The Area note as system prompt

For Julian. Date: 2026-08-27. Full reasoning and evidence: `design-record.md` beside this file.

## What the survey found

29 Areas have a note, 6 have none. `otto/tangent` is 263 lines: 138 Goal links, 33 appended ideas, 60 lines of prose. Only 9 notes have a `Current`, and the longest still describes 2026-08-16. Commits on the tangent note: 148 `add`, 12 `update`. The README rules are right. Nobody obeys them.

## The template

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

## The rule per section

| Section | Rule |
|---|---|
| Purpose | What this Area is and what done looks like. One to three lines. |
| Resources | Where the work is. Machine lines first, then paths, URLs, environments, links to standing Documents. |
| Knowledge | What an agent needs every time. One line each. A procedure is a `skill-<slug>.md`. A big topic is a Document. |
| Current | What is in motion now. Five lines, present tense, no dates. Rewrite, never append. Name Goals with links. |
| Goals | Machine-written links to open Goals. Reorder by hand, nothing else. |
| Ideas and open questions | Thoughts not yet a Goal. Ten lines at most. A bug is a Goal, not an idea. |
| Development environment | The UI writes it. Leave it. |

A fact lives at the highest Area where it is true for every Area under it. A child never repeats a parent line. Standing: Purpose, Resources, Knowledge, skills. Weekly: Current, Goals, Ideas. History: git and the Goal file, never the note.

## What changes

1. README gets the table above and four edit rules. Rewrite, do not append. Harvest, then delete. Keep the note under 100 lines. No dates, no bug reports.
2. The brain prompt gets one sentence: keep the note under 100 lines, harvest then delete.
3. The server drops a Goal's link from `## Goals` when the Goal is done or dropped.
4. Work shows one dim line per Area: `<n> lines · Current <d> days old`. Warning color past 100 lines or 14 days.
5. A brain or Goal start on an Area with no note writes the template first.
6. No new parser. The machine reads only Resources lines, the environment block, Goal links, `Idea:` lines, and skill frontmatter.

## Your word is needed on

1. Done Goal links leave the note. `tangent goal list` and git keep them. Yes or keep them?
2. Commands and conventions go under Knowledge, not Resources. Resources stays "where the work is". Agree?
3. One `Repository:` per Area. `pgande` names two. The second becomes a child Area or a free `- Path:` line. Agree?
