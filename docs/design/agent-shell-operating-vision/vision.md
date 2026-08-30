# Agent Shell: the operating vision

For Julian. Date: 2026-08-27, revised twice after your answers the same evening. Full reasoning and evidence: `design-record.md` beside this file.

## The idea in one paragraph

Three actors, two lines of contact. You talk to the brain. The brain talks to Tangent with a few CLI commands and to its workers with prompts. A worker has exactly two contacts with Tangent: the opening prompt it receives, and `tangent send brain`. Everything the brain needs to know is Markdown in the Area folder: resources, skills, processes, plan. The one exception is the default harness, model, and effort, which you set in the UI.

## Who does what

| Actor | Talks to | With |
|---|---|---|
| You | The brain | A message in Work (`a` on an Area). `x` on a Goal row to mark it, park it, or flag it `verify`. Restart on the brain row. |
| The brain | Tangent | `tangent goal create --start`, `goal append`, `goal done`, `goal list|show`, `send <worker>`, `vault commit`, `process list`. Plus planning and research when it needs them. |
| The brain | Its workers | The opening prompt. Messages with `tangent send <session>`. |
| A worker | The brain | `tangent send brain "<note>"`, `--done`, or `--blocked` for a real dependency. Nothing else. The opening prompt says so. |
| Tangent | The brain | Notes in its inbox: a worker finished, a process is due, you sent a message, you answered. |
| Tangent | You | One macOS notification when a Goal you flagged is ready to check. A small mark in Work when a brain has a question. |

## What you get, day to day

| You want | You do | What happens |
|---|---|---|
| Start work | `a` on the Area, type what you want, `⌘↵` | The brain gets it. If no brain is running, one starts with your message. The brain creates the Goal and starts a worker in the Area's repository. |
| Know when it finished | Nothing | The worker sends `--done`. The brain reads the note and marks the Goal done. |
| Check a piece of work yourself | Say so in your message, or `x` on the row and flag `verify` | When the brain marks it done, the Goal shows `Check it` instead and you get one notification. Click it, read the worker's note, mark it done or tell the brain what is wrong. |
| See a brain's question | Nothing | A small mark on the Area header. No notification. |
| Restart a brain | Restart on the brain row | The row always shows the context fill so you can see when. |
| Resume a conversation | `r` on the attempt row, or `tangent goal show <slug>` | A session opens in the right folder with the resume command typed, never submitted. |
| Have work repeat | `process-<slug>.md` in the Area with a `schedule:` and a body | When due, Tangent tells the brain. The brain starts it. `tangent process list` shows what you have and when. |
| Give an Area a skill | `.agents/skills/<name>/SKILL.md` in the Area folder | Codex and Claude discover it. The brain names its path in a worker's prompt. |
| Tell the brain where things are | `## Resources` in the Area note: `- Repository:`, `- Worktree:`, `- Branch:` | The brain prompt shows them. Workers start there. A start with no folder is refused. |

## What changes

| Today | After |
|---|---|
| You can start workers around the brain. The server refuses a start without a typed harness. | Only the brain starts workers. If it names no harness, its own is lent, as you decided. |
| Workers know `tangent goal`, `handover`, `vault commit`, `process list`, and more. | Workers know one command: `tangent send brain`. The server refuses anything else from a worker session. |
| `tangent handover`, `tangent goal handover`, `tangent brain handover`, `tangent agent send`. | `tangent send`, with `--done` and `--blocked`. |
| A brain hands itself over every 90 minutes. | A brain runs until you restart it. Its plan Document is its memory. |
| Tangent closes Goals after a designated review. A brain files Tests for you. | The brain marks Goals done. A Goal you flagged waits for you instead. Brains never file Tests. |
| Triggers in a git-ignored JSON file, run by a LaunchAgent, with retained REPLs. | `process-<slug>.md`. When due, the brain gets a note and starts a normal Goal. |
| `tangent process` means servers and watchers. | `tangent service` means servers and watchers. |
| Nothing records which conversation an attempt was. | The attempt records the folder and the conversation id. `harnesses.md` says how to resume. |
| Workers fall back to the vault folder silently. Brains run inside product repos. | A start without a folder is refused. Brains run in their Area folder in the vault. |

## Your answers, recorded

1. Brains are not blocked on you. Only a Goal you flagged waits for you.
2. Brains open in the vault Area folder.
3. Skills use the agent `SKILL.md` convention. ADR-0045 supersedes the earlier file convention.
4. `tangent process` becomes `tangent service`. "Process" is your repeatable work.
5. No brain handover or rotation. You restart brains yourself.
6. Brain questions do not notify. Only "check this finished work" does.
7. Every start has a harness: named, or the brain's own.
8. Everything goes through the brain. Workers only receive a prompt and send to the brain. Facts for the brain live in Markdown, except the default harness you set in the UI.

## Order of work

1. Area resources and folders: one parser, `Branch:` line, inherited, refusal, brain cwd, README.
2. Worker contract: the small opening prompt, `tangent send brain` with its three flags, the server refusing other commands from workers.
3. Brain contract: `a` sends to the brain, handover and pacing removed, `goal done` on a flagged Goal becomes `Check it` with the notification.
4. Resume.
5. Processes and the `service` rename.
6. Skills in the brain prompt.
