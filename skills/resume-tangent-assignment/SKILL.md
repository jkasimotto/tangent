---
name: resume-tangent-assignment
description: Recover a Tangent brain or Goal assignment after an agent exits, a harness changes, or its opening instructions are missing. Use only inside a Tangent-managed tmux session or when given its session name; do not use for ordinary unassigned shells.
---

# Resume a Tangent assignment

Read the authoritative recovery projection before doing work:

```bash
tangent agent context --json
```

Use `tangent agent context <session> --json` when recovering another named session.

- If `role` is `brain`, use the founding instruction, checkpoint, rebuilt `prompt`, and every `unreadNotices` entry. Treat the notices as current even when the terminal never displayed them. Continue as that Area brain.
- If `role` is `worker`, read the Goal file, done condition, current assignment instruction, prior notes, reports, and rebuilt `prompt`. Continue only when `current` is true. Finish with `tangent send brain` as that prompt says.
- If `promptError` is present, continue from the durable fields and use `tangent send --help` for the syntax. Do not treat a prompt rebuild failure as a lost assignment.
- If `current` is false, report that this is historical context. Do not resume or mutate the current work.
- If `role` is `unassigned`, or the command reports no durable context, stop. Do not create, own, restart, replace, or kill work to manufacture an assignment.

Do not ask Julian to repeat information present in the projection. Do not kill or replace the tmux session during recovery.
