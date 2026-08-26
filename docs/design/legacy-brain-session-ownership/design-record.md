# Legacy brain session ownership

## Problem contract

ADR-0036 added an Agent Shell instance marker to each new tmux session. A live brain from an older controller has no marker.

The start route rejects that brain before the resume workflow can continue. As a result, an Agent Shell upgrade can strand a durable brain.

The fix must meet these conditions:

- An explicit resume can recover the exact legacy session in the brain record.
- Automatic recovery cannot claim a markerless session.
- A controller cannot claim a session with a foreign instance marker.
- A markerless session without matching brain tags remains unchanged.
- A successful claim creates the live marker and the durable owner sidecar.
- Existing marked sessions keep their current behavior.

The fix does not adopt legacy Goal workers or arbitrary terminal sessions. It does not change the instance identity algorithm.

## Current system

**Observed:** `session-ownership.mjs` classifies a live session without an owner marker as `legacy`. Its `terminate` operation refuses that session.

**Observed:** `startBrainUnlocked` inspects the session from the durable brain record. It returns a conflict for every live session not owned by the current instance.

**Observed:** a brain session also has `@tangent_kind`, `@tangent_brain`, and `@tangent_generation` tmux options. The durable record contains the same session, Area, and generation.

**Observed:** new brain attempts store the current instance identity in the brain record and generation. Pre-ADR attempts have no such identity.

**Observed:** the ownership integration test requires all instances to refuse arbitrary markerless sessions. That requirement remains valid.

## Workflow and states

The common path is:

1. Julian resumes a durable brain after an Agent Shell upgrade.
2. Agent Shell reads the exact session from the brain record.
3. Agent Shell finds a live session without the new marker.
4. Agent Shell compares the live brain tags with the durable record.
5. Agent Shell claims the session for this instance.
6. Agent Shell reattaches to the same brain attempt.

The claim fails without mutation if any tag differs. The existing ownership error remains visible in that case.

Automatic reconciliation does not perform this workflow. It has no direct user action that authorizes the compatibility claim.

## API and state analysis

The ownership module owns the tmux marker and sidecar. It must also own the claim mechanism.

The brain lifecycle owns the policy that permits a claim. The start route supplies the user intent through `resume: true`.

The claim contract accepts the expected legacy identity:

```js
claimLegacyBrain({ session, area, generation })
```

The operation reads the immutable tmux session ID, current owner, and brain tags together. It writes through the existing `claim` operation only after all values match.

The result uses existing ownership states where possible. A mismatch returns a distinct state with the observed values for diagnosis.

## Candidate designs

### A. Keep the refusal and show a manual tmux command

This option preserves the strictest boundary. It leaves every upgraded brain blocked until Julian repairs tmux state outside Tangent.

This option loses because routine upgrade compatibility becomes an operator procedure. The resume action already names the exact durable brain.

### B. Claim all markerless sessions during controller startup

This option makes upgrades transparent. It can claim unrelated sessions before a user selects the correct Agent Shell instance.

This option loses because startup has insufficient intent and scope. It also weakens isolation for concurrent controllers.

### C. Claim one exact legacy brain during explicit resume

This option uses the durable record, three live tags, and explicit user intent. It does not change arbitrary kill or automatic recovery behavior.

This option wins because it restores the blocked workflow with the smallest compatibility boundary.

### D. Start a new attempt and leave the legacy process alive

This option avoids a claim. It can create two live brains for one Area.

This option loses because duplicate brains can dispatch conflicting work.

## Decisions

**Decision:** An explicit resume can claim one markerless brain session when all durable and live identity fields match.

**Decision:** The ownership module validates and writes the marker. The brain lifecycle decides when the compatibility operation is permitted.

**Decision:** Automatic recovery, handover, stop, generic kill, workers, and terminal attachment cannot claim legacy sessions.

**Decision:** A foreign marker always wins over legacy evidence. Resume continues to return the foreign-owner conflict.

**Decision:** The successful claim writes the existing sidecar format. No stored-data migration or dual-read period is necessary.

**Decision:** The runtime logs one structured legacy-claim event. A failed claim returns the existing ownership error and leaves the session unchanged.

## Compatibility and operations

Old brain records remain readable through the existing normalization code. The compatibility path does not rewrite their schema solely for ownership.

The live marker and sidecar become authoritative after a successful claim. A controller restart then follows the normal ADR-0036 path.

The rule has a permanent but narrow compatibility cost. It can be removed when supported upgrades can no longer have pre-ADR live brains.

Operators can diagnose a failed claim from the session name, expected Area and generation, and observed tmux tags. The operation has no retry loop.

## Risks, assumptions, and unknowns

**Assumption:** the explicit resume request comes from Julian through the local Agent Shell interface.

**Risk:** two controllers can receive explicit resume requests for the same markerless brain at nearly the same time. The final marker identifies one winner.

The losing controller must inspect the marker again and report a foreign-owner conflict. The implementation must not overwrite a marker after another controller claims it.

## Sources

- `packages/agent-shell/app/session-ownership.mjs`
- `packages/agent-shell/app/server.mjs`
- `packages/agent-shell/app/agent-shell-instance-ownership-http.test.mjs`
- `docs/decisions/ADR-0036-agent-shell-process-ownership.md`
- `packages/agent-shell/docs/runtime-operations.md`
