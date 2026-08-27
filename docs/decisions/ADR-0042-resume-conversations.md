# ADR-0042: Resume conversations

Date: 2026-08-27

Status: accepted. Design: `docs/design/agent-shell-operating-vision/design-record.md`, D21 to D23, and `evidence/harness-resume.md`.

## Context

Each attempt on a Goal is one harness conversation. Tangent recorded the tmux session name and nothing else. The tmux name is reused across attempts and dies with the session. When a worker ended, Julian had no way to reopen its conversation, and `tangent goal show` did not list attempts.

Every harness has its own resume syntax. Claude Code resumes with `claude --resume <id>` and takes `--session-id <uuid>` at start. Pi takes `--session-id <id>` and resumes with `--session <id>`. Codex resumes with `codex resume <uuid>` and takes no id at start. Its rollouts under `~/.codex/sessions` record the folder and the start time.

## Decision

1. `harnesses.md` says how to resume. The registry block is `tangent.harnesses.v2`. A harness entry can carry `resume`, `sessionIdArg`, and `transcripts`. `resume` is a template with `{command}` for the launch line and `{id}` for the conversation id. `sessionIdArg` is a template with `{id}`. `transcripts` is the folder the harness writes conversations to. A v1 block reads as v2 with no resume fields. A harness without `resume` has no Resume verb. The Document says Tangent appends two flags only: `--model default` and `sessionIdArg`.
2. The attempt records the conversation. For a harness with `sessionIdArg`, Tangent makes a fresh uuid when the step starts and appends the flag to the launch line. The attempt stores `providerSession: { provider, id }` before the session exists. The recorded `resolvedLaunch.command` stays the registry's string. A continued session keeps its conversation. For codex, `tangent goal show <slug> --conversations` finds the rollout by the attempt's `cwd` and start time. Two matches are both shown. The attempt also keeps the last context fill seen while live as `contextFill`.
3. Resume is a verb on the attempt. `r` on a Goal row in Work resumes its latest attempt. The Goal reader lists every attempt with a Resume button that prints `r`. A live attempt is attached. A dead attempt opens a new owned tmux session of kind `resume` in the attempt's `cwd`, with the resume command typed and never submitted. The session carries no Goal, so a finished Goal can be resumed and nothing rebinds it. The fill shows on every Work row that reports one.
4. `tangent goal show <slug>` prints per attempt: session, cwd, harness, conversation id, resume command, and last context fill.

## Consequences

- `POST /api/goals/attempts/resume` takes `{ goal, attemptId?, conversationId? }` and answers `{ status: "live" | "resumed", session, command }`. A worker session cannot call it.
- `GET /api/goals/detail?conversations=1` looks up conversations that were not recorded at launch.
- `harness-conversation.mjs` owns the templates and the codex rollout lookup. Agent Shell reads transcript folders itself and never imports Usage.
- The live server must restart to read a v2 block. An old server reads no registry from a v2 file.
