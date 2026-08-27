# Work view: fold, cursor, and key hints

For Julian. Date: 2026-08-27. Full reasoning: `design-record.md` beside this file.

## What the `+ 1` pill is

It is the fold button. It prints `+` and the key `l` in 8px Menlo. The `l` looks like `1`. It counts nothing. The count `3 open · 1 moving` sits next to it. The `▸` before the name marks the cursor row, not a tree.

## Before and after

```
before  | ▸ Neara [+ l]  3 open · 1 moving   1 question        Open brain b   ⋯ |

after   | ▸ Neara   3 open · 1 moving   1 question r        Open brain b   ⋯ : |   folded
        | ▾ Neara   3 open · 1 moving   1 question r        Open brain b   ⋯ : |   open
        |     Fix login timeout               Working   12m          Open ↵  ⋯ : |
        |     Ship onboarding   2 Subgoals    Ready      -           Open ↵  ⋯ : |
```

The triangle at the far left is the only fold glyph. It rotates. The cursor row keeps its blue bar and tint, and loses its triangle. Every button with a verb prints its key at the right, in one style, always visible. The caption line prints the keys of the current row.

## Keys, future table

| Row | Action | Key | Today |
|---|---|---|---|
| Area | Message the brain | `a` | `a` is New Goal today |
| Area | Open the brain | `b` or `↵` | same |
| Area | Fold, unfold | `h`, `l` | same |
| Area | More | `:` | same |
| Goal | Open | `↵` | works, not printed |
| Goal | Read | `o` | same |
| Goal | Status: done, won't do, park, verify | `x` | no verify yet |
| Goal | Change agent | `c` | same |
| Goal | Start agent | none | button goes with the vision |
| Attempt | Resume | `r` | no attempt rows yet |
| Any | All keys | `?` | same |

## Your word is needed on three points

1. Fold on click of the triangle only (Finder, Xcode), or of the whole header row (VS Code, Linear)? The name opens the brain today. I recommend the triangle only.
2. Keep `3 open · 1 moving` on the header in both fold states, or only when folded? I recommend both.
3. Keys always visible on buttons, or on hover only? I recommend always.
