# Authentication wall false positive: debug record

Goal: [[goal-authentication-walls-are-reported-only-when-real]]

Date: 2026-08-30

## Result

Tangent classified a Slack MCP warning as a Codex authentication wall.

The Codex worker was logged in and continued to work. The worker did not have a harness authentication error.

The fault has two parts. The classifier accepts the words `not logged in` anywhere in a Codex pane.

The observer also publishes a wall while the same observation says that the worker is active.

## Incident evidence

The durable assignment launched `codex-gw/sol/low` in the requested worktree.

Its first attempt has identifier `586a7c75-3260-4343-b198-f69b6aa6d27a`. The attempt kept the original tmux target `$1935`.

The pane scrollback remains available in session `standards-improve-test-cases-for-neil-and-add-pole-conduct`.

The startup screen contains this exact warning:

```text
⚠ The Slack MCP server is not logged in. Run `codex mcp login Slack`.
```

The same screen contains the Codex model header, assignment, progress, edits, and verification commands.

The provider rollout started at `2026-08-30T05:50:52.131Z`. Its last parsed event was at `2026-08-30T05:58:38.213Z`.

The wall notice was created at `2026-08-30T05:50:55.115Z`. Thus, the worker produced transcript events for more than seven minutes after the notice.

The durable assignment started at `2026-08-30T05:50:50.778Z`. The notice followed 4.337 seconds later.

The notice exposed only `not logged in`. It did not expose Slack, MCP, the full line, or the matched harness.

The notice source ends in `8d4a205b5948e1917661`. This value equals the first 20 hexadecimal characters of this hash:

```text
sha256("auth\0\0not logged in")
```

This equality proves that the generic authentication match created the notice.

The local `codex login status` command reported `Logged in using ChatGPT` during the diagnosis.

The exact Goal has no replacement record. Julian stopped the brain before it replaced this healthy worker.

## Misclassification path

1. `pane-state.mjs` maps `codex-gw` to the Codex signature family.
2. The Codex authentication pattern accepts the unqualified phrase `not logged in`.
3. `wallFromText` scans the complete visible pane, including warnings, prompts, and old output.
4. The pattern matches the Slack MCP warning and returns only the matching phrase.
5. `pane-observer.mjs` records active screen output and the authentication wall in one observation.
6. `server.mjs` sends every observed wall to the Area brain without a consistency check.
7. `attempt-state.mjs` gives a wall priority over fresh activity.
8. The Work UI shows the short wall match as its evidence.

The observer probe produced this contradictory state:

```json
{
  "state": "working",
  "activity": { "source": "screen" },
  "wall": { "kind": "auth", "text": "not logged in" }
}
```

The contradiction is possible because the observer calculates `wall` separately from the screen-hash state.

## Competing hypotheses

| Hypothesis | Required observation | Result |
|---|---|---|
| Codex authentication failed | Codex cannot accept the assignment or produce work | Rejected. The same pane produced edits and events after the notice. |
| The pane belonged to an old attempt | The tmux target differs from the durable target | Rejected. The live session and durable attempt both use `$1935`. |
| A Claude pattern matched a Codex pane | The launch family is unknown or Claude | Rejected. `codex-gw` selects the Codex family. |
| A stale prior pane created the notice | The warning predates this tmux session | Rejected. The warning is part of this Codex startup screen. |
| Replacement logic invented the wall | A replacement exists before the notice | Rejected. The notice comes directly from the pane observation. |
| The generic Codex pattern matched Slack | The source hash equals the short authentication match | Supported. The hashes are equal. |
| Active output suppresses a wall | A changing pane has `wall: null` | Rejected by a focused observer probe. |

## Scope of the defect

The Standards brain received five notices with the same source hash on 2026-08-30.

Two earlier notices caused normal replacement operations. Those operations retired healthy Codex source attempts after their replacement prompts arrived.

The first source retired at `2026-08-30T04:55:14.445Z`. The second source retired at `2026-08-30T05:00:49.603Z`.

The replacement protocol followed its target and confirmation rules. The false observation entered that protocol before replacement started.

The patterns also accept normal prompt text. A prompt with `not logged in` becomes an authentication wall.

The Codex quota pattern accepts the word `quota` by itself. A prompt about quota states becomes a quota wall.

A Claude prompt that quotes the known quota sentence also becomes a quota wall.

An unknown harness runs every signature family. Therefore, foreign prompt text can become a Codex or Claude wall.

Pi has an empty wall table. A named Pi pane did not reproduce the cross-family match.

The Codex update notice did not match a wall. However, no regression test protects update notices.

A shell exit currently has priority because the observer returns before it reads pane text. This behavior needs a regression test.

## Existing test gap and history

Commit `e5565962` added the wall patterns on 2026-08-29.

The approved design said that wall text was unknown. It required an empty pattern until a real harness capture existed.

No authentication or quota fixture exists in `fixtures/panes`. The added tests use short synthetic strings.

The current pane tests all pass. They do not include MCP warnings, normal prompts, active output, stale lines, or unknown harnesses.

A temporary automated regression reproduces the defect:

```text
node --test /private/tmp/tangent-auth-wall-regression.test.mjs
tests 3
pass 0
fail 3
```

The three failures cover the Slack warning, ordinary prompt text, and active screen output.

## Smallest complete correction contract

### Wall evidence

1. Keep a wall pattern empty until a real capture proves that harness screen.
2. Match only the named harness family. Do not apply another family to an unknown harness.
3. Match a complete harness-owned status line and its required screen context.
4. Do not use bare phrases such as `not logged in`, `authentication required`, `quota`, or `usage limit`.
5. Treat an MCP, plugin, connector, or tool login warning as a dependency warning.
6. Do not turn a dependency warning into a harness wall.
7. Keep authentication, quota, rate-limit, update, dialog, composer, shell, and active states distinct.

Until a real authentication capture exists, the harness must report `Unknown`, `Idle`, `Working`, or `Stopped` from stronger evidence.

It must not report an authentication wall from an assumed string.

### Current state

1. Make one observation internally consistent.
2. If the screen or transcript proves current work, set `wall` to `null`.
3. Publish a screen wall only from a verified terminal candidate on a non-working sample.
4. Clear a prior wall when later screen or transcript activity occurs.
5. After a server restart, do not promote a retained old line without current terminal evidence.
6. Keep a shell exit authoritative, even when the pane scrollback contains old wall text.
7. Keep queue reports authoritative over all screen evidence.

This contract keeps the existing replacement protocol. Replacement must still start only after Tangent receives a verified terminal wall.

### Visible evidence

1. Store the full matched line in `observation.wall.text`.
2. Store the harness family and a stable pattern identifier with the wall.
3. Keep the wall kind, model, first observation time, and evidence source.
4. Show the full line, harness, wall kind, and time in the brain notice.
5. Show the same evidence in the Work status hover.
6. Do not show a regex fragment as evidence.

### Harness cases

- `codex` and `codex-gw` can share a pattern only when a real capture proves identical screen output.
- `claude` and `claude-otto` can share a pattern under the same rule.
- `pi-code`, `opencode`, `claude-gw`, `agy`, and `agyd` must have no wall pattern until each family has evidence.
- A verified quota screen must produce `quota`, never `auth`.
- A verified authentication screen must produce `auth`, never `quota`.

## Affected implementation and tests

- `packages/agent-shell/app/pane-state.mjs`: replace speculative substring patterns with verified screen signatures.
- `packages/agent-shell/app/pane-observer.mjs`: make activity and terminal walls mutually exclusive.
- `packages/agent-shell/app/server.mjs`: send notices only for verified walls and include full evidence.
- `packages/agent-shell/app/attempt-state.mjs`: reject contradictory active and wall observations defensively.
- `packages/agent-shell/app/public/work-desk-view.js`: show the complete server evidence without reclassification.
- `packages/agent-shell/app/fixtures/panes/`: add real positive and negative captures.
- `packages/agent-shell/app/pane-state.test.mjs`: add prompt, update, MCP, quota, authentication, and cross-harness cases.
- `packages/agent-shell/app/pane-observer.test.mjs`: add active, stale, restart, and shell-exit cases.
- `packages/agent-shell/app/attempt-state.test.mjs`: add the contradictory-observation regression.
- `packages/agent-shell/app/work-table-ui.test.mjs`: prove that the exact evidence reaches the UI.
- A server notice test: prove that the brain receives one complete verified line and no false notice.

The implementation does not need a replacement-flow change. It needs a trusted wall boundary before that flow.
