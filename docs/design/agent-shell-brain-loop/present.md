# A loop on a brain

Full record: `design-record.md` in this folder.

## Proposal

A loop is a process note with `every:` alone. The body is the message. Every N minutes, while the brain runs, the server sends the brain that body.

```markdown
---
type: process
status: active
every: 20m
---
Look at the open questions on this Area. Answer what you can. Say what still waits for Julian.
```

Save it as `neara/pgande/process-nudge.md`. Nothing else is needed. The message the brain gets reads:

`Loop nudge (every 20m): Look at the open questions on this Area. ...`

Pause, resume, and inspect with the commands that exist: `tangent process pause|resume|check nudge`. Erase the note to remove the loop.

## What you see

- Work view: a small `↻` after the brain button of an Area that has an active loop. Hover shows `Loop every 20m: Look at the open...`. Nothing else on Work.
- Area page: the loop is one row in the Processes table. When column says `Every 20m, to the brain`.

## How it fits what exists

Process notes already have `schedule:` (start a Goal at a time) and `when:` plus `every:` (poll a probe, then start a Goal). The 10 s scheduler lane, the state file, the inbox, pause and resume, the Area table, and `tangent area show` all stay as they are. The loop is a third shape of the same note. The change is about 60 lines, with one paragraph added to ADR-0043.

## Decisions you can disagree with

1. **No brain, no tick.** A loop is a heartbeat, not work owed. A missed heartbeat is not queued, so a returning brain does not read twenty stale nudges. A scheduled process keeps its waiting note, as today.
2. **One message in flight.** The next tick waits until the last one reached the composer. This is the `/loop` behaviour. Safety net: after three intervals with no delivery, it fires anyway.
3. **No create command.** You or the brain writes the note, like every other note. The brain instructions get one sentence about it. A `tangent loop create` was the strongest alternative and lost because the definition would leave the vault, the same way routines and triggers did.
4. **Floor of one minute.** `every: 30s` is a broken note.

## Works today, if you need it before this ships

A LaunchAgent that runs `tangent send neara/pgande "<text>"` every N minutes reaches the brain now. Nothing shows it and nothing stops it stacking while the brain is away, which is why it is not the design.
