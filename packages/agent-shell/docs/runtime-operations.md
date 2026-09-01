# Agent Shell runtime ownership operations

This guide diagnoses process ownership for Agent Shell. See ADR-0036 for the
decision.

## Identify an instance

`TANGENT_SHELL_INSTANCE_ID` sets one explicit identity. Independent Agent Shell
instances must use different values.

Without that variable, Agent Shell derives a stable identity from these values:

- public host and port;
- `TREES_ROOT`;
- `CHAT_SESSION`.

The gateway passes the same identity to each replacement controller. A rebuild
or controller restart must not change it.

Inspect the public identity:

```bash
curl -s http://127.0.0.1:4321/api/health
```

The response includes `instanceId`. The session diagnostic includes the same
runtime identity.

## Inspect a live session

The live ownership key is `@tangent_agent_shell_instance`. Inspect one exact
session with its immutable tmux ID:

```bash
tmux display-message -p -t '=SESSION:' '#{session_id} #{@tangent_agent_shell_instance}'
```

The second value must equal the server's `instanceId`. A missing value means
that the process is legacy.

Do not add the option manually. An explicit brain resume can claim one legacy
brain when its durable record matches its live brain tags.

## Inspect stale recovery evidence

Agent Shell stores owner sidecars here:

```text
~/.tangent/agent-shell/session-owners/
```

Each JSON record contains `session`, `instanceId`, and `claimedAt`. The file
name is a hash of the session name.

Job Attempts and Brain generation records also store `instanceId`. Compare all records with
the public health identity before you diagnose recovery.

Controller startup logs include `instance=<id>`. Gateway health names its
identity and the controller identity.

Failed brain recovery logs use `brain recovery start`. The JSON evidence names
the Area, instance identity, status, and error.

## Handle legacy processes

A process without the live ownership key is a pre-change process. Agent Shell
keeps it alive and refuses cleanup, reconciliation, or automatic recovery.

An explicit resume can claim the exact legacy brain from its durable record.
The session, Area, generation, and live brain tags must match.

Let the process finish when possible. If removal is necessary, inspect it and
stop it manually outside Agent Shell. Then relaunch work through Agent Shell.

Agent Shell does not provide a general adopt command. A new launch creates
both live and durable ownership evidence.

## Verify the boundary

Run the focused production-path proof:

```bash
node --test packages/agent-shell/app/agent-shell-instance-ownership-http.test.mjs
```

The test starts two controllers on one private tmux socket. It checks explicit
kill, reconciliation, cleanup, brain replacement, stale recovery, rebuild,
shutdown, and legacy refusal.

The governance rule `agent-shell/session-ownership-contract` rejects raw tmux
termination outside `session-ownership.mjs`.

## Job conversion and rollback

`job.v1` remains under the historical `pipelines/<area>/<slug>.json` path. Old `area-goal-queue.v2` and `agent-pipeline.v1` files are read in memory as run 1. Their first mutation writes `job.v1` with all Attempt and report history. Do not roll a state root that contains `job.v1` back past the compatibility foundation release.

Work v3 publishes bounded source and model problems. Use the exact Goal, Job,
Agent, Brain, Process, or Area route to inspect a problem. Work does not contain
the complete diagnostic record.

## Inspect Work freshness

`GET /api/health` reports the Work state, epoch, revision, bytes, age, source
conditions, last rejection, reconciliation state, and bounded metrics.

`GET /api/work` is a gateway memory read. A valid store returns `200` or `304`.
It does not wait for the controller. `x-tangent-work-state` is `current`,
`degraded`, or `stale`. A stale or degraded response keeps the last complete
body.

The store is under `~/.tangent/agent-shell/work/`. Do not edit it. A corrupt
envelope is quarantined and the controller builds a new epoch.

Pi harness debug logs are under
`~/.tangent/agent-shell/harness-logs/pi/`. Agent Shell rotates a log above
8 MiB and keeps at most 64 log files. A Pi launch can leave a project-local
`.pi/debug/log.jsonl` symbolic link. The link points to the bounded runtime
store. Vault enumeration ignores hidden directories.

## Succession recovery

Brain succession stores the staged generation, expected prompt hash and byte count, included notice IDs, deadline, activity fence, immutable targets, and receipt state before delivery. On controller restart, armed-prompt recovery reconstructs exact receipt verification. A promoted operation retries outgoing retirement. An expired unpromoted operation terminates only the successor and leaves the outgoing Brain authoritative.

Lifecycle logs use `job.*`, `agent.*`, `brain.succession.*`, and `compat.alias.used`. They contain operation IDs, addresses, run and revision fences, actor roles, outcomes, immutable targets, prompt hashes, byte counts, and notice IDs. They do not contain Goal bodies, notices, or prompts.
