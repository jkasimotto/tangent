# Agent Shell operating rules

Agent Shell uses tmux for native agent sessions. Do not detach or kill the orchestrator session. The vault contains Areas, Goals, and Documents.

## Vocabulary

- An Area is a durable subject that the user creates explicitly.
- A Goal records something the user wants to make true.
- A Subgoal is another Goal linked by “To do that.”
- A Document stores reusable knowledge linked to relevant Goals.
- A Program is a repeatable operation attached to an Area.
- A Run is one agent session working on one Goal.

## Start a Run

If the user names an Area, read its canonical note first. Use the repository or worktree in `## Resources`. Before you start a server or watcher, run `tangent process list`. Start a matching Program with `tangent process start <name>`.
Otherwise, create a tmux session in the selected directory. Confirm that its name is not in use. Always quote directory paths.

Bind each Goal Run with these tmux options:

```sh
tmux set-option -t <name> @tangent_area '<area-path>'
tmux set-option -t <name> @tangent_goal '<vault-relative-goal-file>'
tmux set-option -t <name> @tangent_kind 'goal'
```

A Program uses `@tangent_area`, `@tangent_kind`, and `@tangent_process`.

## Maintain the vault

Each Area is one directory. Its canonical note uses `type: area`.
Create an Area only after user confirmation. Do not infer an Area from each subject in a Goal.
A Goal file uses `goal-<slug>.md` and `type: goal`. Its frontmatter contains `status`, `done_when`, and `session`.
When the opening prompt provides `goal-command.mjs`, use that command for every confirmed new Goal and Subgoal. Do not hand-write Goal frontmatter or Area links. The command validates and writes the current schema through Agent Shell.
Legacy `outcome-*.md` files remain readable during migration. Do not create new legacy Outcome files.

Link ordered Subgoals in `## Subgoals`. Keep small actions in the agent plan or `## Steps`.

Link each Document to the Goals that explain why it exists. Store the Document in a suitable Area.

Before you write design prose, use the Simple English skill in pragmatic mode. Complete its mandatory self-check.

Keep `## State` current. Keep exactly one `You wanted` bullet in `## Current brief`.

Add a short Story moment only when feedback, a decision, or a result changes the plan. Keep no more than five moments.

Propose marking a completed Goal done. Never mark it done without confirmation.

## Safety

- Confirm the target before you send tmux keys.
- Never kill, detach, or send keys to the orchestrator session.
- Ask before you close a session that the user did not name.
- Keep one session per named Goal or Program.
- Use `@tangent_area` as the authoritative save target.

## Read next

No package docs exist because this directory is only a session workspace. Read `~/.tangent/trees/README.md` for commit and provenance rules. If its storage examples still describe Outcomes, the opening prompt's deterministic Goal command is authoritative for new work.
