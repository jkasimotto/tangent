# ADR-0059: Cost shows only the live session

Date: 2026-09-03

Status: accepted. Amends ADR-0057 and ADR-0058, whose pricing rules it keeps.

## Context

ADR-0057 put one dim figure in the top bar: what the machine spent today,
across every harness, with a hover breakdown. ADR-0058 then gave every worker
its own figure, covering its whole life, on the row and inside the session.

Two figures answered two different questions on the same screen, and only one
of them was a question Julian asks. A day total is a number nobody can act on:
it moves when midnight passes, it mixes work that is finished with work that
is running, and no press on it changes what any agent is doing. The per-worker
figure is the one that answers "what is this costing", because it names the
thing the money went to.

An Area brain had the same problem in smaller form. Its figure covered every
generation the brain had ever run, so an Area whose brain had been up for
weeks printed a number that said nothing about the session on the screen, and
an Area with no brain running printed one anyway.

## Decision

**The top bar carries no cost figure.** `GET /api/cost`, the day window, the
snapshot summary behind it, the browser poller and the breakdown panel are
gone rather than hidden. `GET /api/cost/workers` is the whole cost surface.

**A brain shows its live session's spend, or nothing.** The figure beside the
`brain` button in the Area header is keyed by the live tmux session, the same
key the brain pane already used. An Area with no live brain session shows no
figure: there is nothing running to have spent anything.

**A reading has no window.** `recordedAttempts` reads every attempt on the
machine and `inWindow` is gone. Every figure covers a worker's whole life, so
no figure changes when the day rolls over.

**A machine-wide gap rides on every figure.** The top bar used to be where a
broken pricing Document or an unreadable harness registry was named. With no
surface above the figures, each figure says it itself: the registry error
enters the index as an unattributed reason per worker, and the pricing error
is a note appended to every worker's reasons. Both make a figure a floor.

## Consequences

`GET /api/cost` returns 404. Nothing outside the shell read it.

The cost service holds one index instead of a snapshot and an index, and
`createCostService` exposes only `readWorkers`. The refresh clock, the cache
and the honesty rules are unchanged.

ADR-0057's "the top bar reads its own `GET /api/cost`" clause and ADR-0058's
"only the top bar is windowed" clause no longer hold. Everything else in both
records stands: the provider axis, the rate table, no guessed rate, the
conversation as the unit of cost, the ledger while it is the last word, and a
figure that names what it leaves out.
