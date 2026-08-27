# ADR-0037: A user can override one brain attempt

Date: 2026-08-27

Status: accepted

## Context

Each Area declares a Brain launch default. Agent Shell resolves that default before each new brain attempt and stores the result on the generation.

The browser previously showed the resolved default but rejected every per-attempt choice. Julian could not try another registered harness, model, or effort without editing durable Area policy first.

Workers already support an explicit registered launch choice. Their queue records keep the resolved evidence for that attempt.

## Decision

A user start or resume can supply one registered Brain launch choice:

```text
{ harness, model?, effort? }
```

The server resolves the choice through the launch catalog. It compares the result with the launch reference that the browser displayed.

The new generation stores the complete resolved launch. This snapshot includes the registry reference, label, command, source, and resolution mode.

The choice affects only that attempt. It does not change the Area Brain default.

An omitted choice resolves the current Area default. Automatic recovery and brain handover also resolve the current Area default.

A live brain is reattached before launch resolution. A request cannot replace a live attempt by supplying another choice.

Raw command overrides remain invalid. A Brain attempt needs a registered harness identity because an unqualified worker can inherit that identity under ADR-0035.

## Consequences

The Brain composer can show the same harness, model, and effort picker as other launch surfaces.

Julian can test one attempt without changing future attempts. The stored generation explains the exact runtime choice later.

A stale browser choice fails before session creation and returns the newly resolved launch for review.

The Area default remains the durable policy. Reattachment, recovery, and handover do not silently repeat a one-attempt override.

The private start route accepts a typed `choice` but continues to reject an edited command.
