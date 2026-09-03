# ADR-0058: Cost per worker

Status: accepted. Design: `~/.tangent/trees/otto/tangent/design-cost-per-worker.md`. Builds on ADR-0057, whose rules it keeps.

## Context

ADR-0057 priced the machine: a total for a window, split by harness and by
model. It answered "what did today cost". It did not answer "what did this
piece of work cost", which is the question a person asks while looking at a
row on the Work screen or sitting inside a worker's terminal.

The window was also in the way. `GET /api/cost` read only the attempts that
started inside its window, so a Goal that ran yesterday had no figure at all
today, and a Goal that ran across two days had two partial ones.

## Decision

**One reading, sliced.** The cost service reads and prices every attempt on
the machine, once, and takes the requested window out of that result. A
conversation is kept whole when any of its attempts started inside the window,
which is the rule the per-day total already used. Measured: 8.3 seconds for
the first reading and 0.2 seconds for each one after it, because a finished
transcript is never read twice.

The alternative was a second walk of the same transcripts for the per-worker
figures. It would have cost the same work twice and let the two answers
disagree about what one conversation cost.

**A worker's figure covers its whole life, not a window.** A Goal's figure
never changes when the day rolls over. Only the top bar is windowed.

**Two keys, from the same reading.** `GET /api/cost/workers` returns `work`,
keyed the way the Work table already names a row (`job:<goal file>`,
`brain:<area>`, `repair:<area>`), and `sessions`, keyed by the tmux session
name, which is what a person is looking at once they have entered a worker.

**A conversation is charged whole to every key it ran under, and is never
split.** Two keys are therefore never added together: a Goal's figure is read
off the Goal's own key, not by adding up its workers.

**A floor is one boolean with its reasons attached.** A live worker, a
conversation priced from tokens rather than from a ledger, a model with no
rate, and an attempt that could not be reached all mean the same thing to a
reader: the real figure is at least this one. The surface prints `~` and names
which of the four applies.

**Subagent inclusion is stated per harness family, as a measurement.** Claude:
the ledger already counts subagents, and the subagent transcripts beside the
parent are read when the ledger cannot be used; over 31 recorded conversations
with subagents the ledger stands above the parent-only price in 31 of 31, by
$150.45 on the largest. Codex: every descendant rollout is read with the
thread; adding them raised the token count in 194 of 194. pi: pi has no
subagent tool, so there is nothing to add; over 692 recorded pi transcripts
the only tools are read, write, edit and bash.

**The figures are written in place.** The Work table repaints on one clock and
the cost reading runs on another. A changed dollar writes into the cells and
never repaints a row, so a moving number cannot take the cursor or the
keyboard focus off the row a person is reading.

## Consequences

An attempt record's `session` is now part of its spend facts, in all three
record families. It was already stored; nothing on disk had to change.

The Work table has a fifth column. Every row builder had to keep the column
count, including the presented-card and overflow rows that print empty cells.

An Area brain and a repair crew have no Work row, so a brain's figure rides
beside the `brain` button in the Area header and inside the live brain pane.

A worker on a harness that declares no transcripts folder still shows nothing
and says why. `codex-gw` and `claude-gw` remain in that state, as ADR-0057
records.
