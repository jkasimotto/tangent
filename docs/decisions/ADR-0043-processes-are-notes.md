# ADR-0043: Processes are notes

Date: 2026-08-27

Status: accepted. Amends ADR-0030. Design: `docs/design/agent-shell-operating-vision/design-record.md`, D16 to D19, and `evidence/processes.md`.

## Context

Julian's rule for Tangent: "tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli."

Repeatable work lived in a `triggers` map inside a git-ignored `.processes.json`. A root command, `tangent trigger`, ran shell probes from a LaunchAgent every minute and pasted instructions into a retained tmux agent. The definition was not in vault history. The probe was an opaque shell string. A finished interactive agent blocked its trigger until someone killed the session. No trigger created a Goal, and no brain knew a trigger existed.

`tangent process` meant servers and watchers. Julian says "process" for repeatable work.

## Decision

1. A process is a note: `<area>/process-<slug>.md`. Its frontmatter has `type: process`, `status: active|paused`, and either `schedule:` (calendar words such as `daily 09:00`, `weekdays 08:30`, `mondays 10:00`, `daily 07:30, 16:00 UTC`) or `when:` (a shell probe, exit 0 means due) with `every:` (a duration such as `30m` or `2h`). Optional `launch:`, `path:`, `verify:`. The body is the instruction the brain gives the worker. An agent writes it like any note. There is no define command.
2. The Agent Shell server is the scheduler. A lane of the runtime scheduler checks every 10 s. Run state lives in `~/.tangent/agent-shell/processes/<area>/<slug>.json` with `firstSeenAt`, `lastDueAt`, `lastNoticeAt`, `lastCheckedAt`, and `lastGoalFile`. Missed slots coalesce to the latest one. A slot before the note was first seen never fires.
3. When a process is due, Tangent tells the brain. The server writes one note to the exact-Area brain inbox: `Process <slug> is due. Start it with: tangent goal create --area <area> --title "<title>" --start --instruction-file <process file> [--path <path>] [--launch <launch>] [--verify]`. Tangent starts no worker. A Goal created with a process note as its instruction file carries `process: <file>` in its frontmatter. The process is skipped while that Goal is open. A `when:` process with an unanswered note is not probed again. If no brain runs, the note waits in the inbox and Work shows the process as `Due, brain not running` with a Start brain button.
4. `tangent process` means repeatable work: `list`, `show`, `pause`, `resume`, `check`. `pause` and `resume` rewrite the `status:` line and commit the note through the vault. `check` evaluates due-ness now and prints why. The Area page shows a read-only Processes table at the top: name, schedule or probe, next run, last run, state. `tangent area show` prints the same lines for the brain.
5. Servers and watchers are `tangent service`. The stored session kind stays `process`. The UI label is Service. `tangent process start|stop|restart|close` reach `tangent service` for one release and print a hint.
6. The `tangent trigger` runtime, its `triggers` manifest map, its state file, its tests, and its LaunchAgent are retired. A manifest that still declares `triggers` is refused with a hint to write a process note. The two triggers that existed are rewritten by hand as process notes in their Areas, with `cwd` as `path:` and the Area's `- Agent:` line as `launch:`. The retained speedrun tmux session is ended.

## Consequences

- `packages/agent-shell/app/process-note.mjs` parses notes and computes slots. `process-scheduler.mjs` owns discovery, state, the sweep, and the view. `process-routes.mjs` serves `GET /api/processes`, `POST /api/processes/control`, and `POST /api/processes/check`.
- `/api/areas/show` and `/api/operations` carry `processes`.
- Process notes are committed vault files. Julian can read them in Obsidian and in git history.
- The server must run for a process to fire. It is a KeepAlive LaunchAgent, so the window is small.
- A process without a brain in its Area waits. The Work view says so.
