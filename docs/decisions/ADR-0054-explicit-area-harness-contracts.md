# ADR-0054: Every Area has an explicit harness contract

Date: 2026-08-31

Status: accepted

## Context

The machine registry lived at the vault root, while Area launch policy lived inside an optional Area-note fence. Absence could mean inheritance, incomplete migration, or accidental deletion. Registry edits could also make a previously reviewed policy stale without a visible contract state. Brain and worker resolution shared the policy evaluator, but the durable boundary was implicit.

## Decision

The root `harnesses.md` remains the only owner of commands, models, efforts, and conversation metadata. Every Area has its own `harnesses.md` containing one `tangent.area-harnesses.v1` block. The contract says `inherits: true`, records a registry revision, and stores only local `allow` patterns and compatibility aliases.

Ancestor declarations intersect. An empty local allowlist means explicit inheritance; it does not remove an ancestor fence. Runtime launch memory remains a preference and is accepted only after registry and effective-policy validation. Historical attempt snapshots remain immutable.

The catalog reports each contract as valid, stale, legacy, missing, or invalid. A malformed explicit contract blocks resolution. Legacy `tangent.environment.v2` policy remains a read fallback until repair. `tangent shell migrate-launch-policy` previews and repairs all Area contracts; repair copies legacy allowlists and aliases or refreshes the registry revision without widening policy. Startup repairs missing, legacy, and stale contracts, but does not overwrite malformed files. New Areas receive a contract in their creation commit.

Generated root brain instructions require `tangent harness list --area <area>` before worker launch and name the repair command. Per-attempt launch overrides remain supported but pass through the same Area policy check.

## Consequences

Launch drift has a visible durable state and one repair path. Existing Areas and aliases keep their effective behavior during migration. Adding or editing a registry intentionally marks Area contracts stale until the shell refreshes them. Area notes no longer need to own launch policy, though their v2 blocks remain readable during the compatibility period.
