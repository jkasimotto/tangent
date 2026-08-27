# Work view: reach sub-Area brains

For Julian. Date: 2026-08-28. Full reasoning: `design-record.md` beside this file.

## The problem in one line

Neara shows 25 Goals from 9 sub-Areas, but only Neara has a header. Six of those sub-Areas have a brain you cannot reach from Work. (`neara/hackathon` is done, so the CLI says 33.)

## Before and after, your real data

```
before  | ▾ Neara   25 open · 2 blockers   ● Brain needs a decision r      Open brain b   ⋯ : |
        |     Propose codebase structure v3 (GLM 5.2)                            Open ↵   ⋯ : |
        |     Design a structure/pole diff …  ESSENTIAL / AUTODESIGN              Open ↵   ⋯ : |
        |     Guy clearances: scope …  PG&E / AUTODESIGN                          Open ↵   ⋯ : |
        |     (23 of 25 rows carry a tag, PG&E / AUTODESIGN five times)                        |

after   | ▾ Neara   25 open · 2 blockers   ● Brain needs a decision r      Open brain b   ⋯ : |
        |     Propose codebase structure v3 (GLM 5.2)                            Open ↵   ⋯ : |
        |   ▾ Essential / Autodesign   1 open                              Resume brain b   ⋯ : |
        |       Design a structure/pole diff to replace the ops key …            Open ↵   ⋯ : |
        |   ▾ PG&E   1 open                                                Resume brain b   ⋯ : |
        |       Wire a valid RESETDATA_API_KEY into the speedrun pipeline        Open ↵   ⋯ : |
        |   ▾ PG&E / Autodesign   5 open                                    Start brain b   ⋯ : |
        |       Guy clearances: scope what they are and how work starts          Open ↵   ⋯ : |
        |   ▸ PG&E / Megabranch / Viz-input   8 open   ● Brain needs a decision r   Open brain b |
```

One thin row per sub-Area that has open Goals. Its Goals sit under it, with no tag. Each row folds alone with its own triangle. A folded row keeps its count and its amber dot. The Neara header still sums everything and still goes amber for a child.

`b` and `a` act on the nearest header above the cursor, as today. No new rule. Reach the Autodesign brain: `}` three times, then `a`.

## Keys

| Row | Action | Key | Change |
|---|---|---|---|
| Any Area header | Previous or next header that is not folded away | `{` `}` | exist today, now visit sub-Areas too, printed in the caption |
| Sub-Area header | Open the brain | `b` or `↵` | new row, same key |
| Sub-Area header | Message the brain | `a` | same |
| Sub-Area header | Fold, unfold | `h`, `l` | `h` on a folded sub-Area goes to Neara |
| Goal under a sub-Area | Go to its sub-Area | `h` | one level deeper than today |

`{` `}` do not wrap, as today. `Other Areas` stays skipped. Folds are remembered in the same store as the Neara fold.

## Your word is needed on three points

1. A folded sub-Area hides its Goals, or still lists them under Neara with tags? I recommend hide. A fold that hides nothing is not a fold.
2. Brain button printed on every sub-Area row, or caption only? I recommend printed, the same as on Neara.
3. Flat rows named by path (`PG&E / Megabranch / Viz-input`), or a nested outline per level? I recommend flat. Depth 4 stays one row.
