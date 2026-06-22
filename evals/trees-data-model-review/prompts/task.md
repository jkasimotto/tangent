You are reviewing the data model of Tangent Trees, the "command and control" layer that tracks coding-agent work (entities, work sessions, agent runs, observations, attention, events).

The schema lives in:
- `packages/trees-schema/src/index.ts` (the core resource, event, observation, and action contracts)
- `packages/trees-schema/src/adapters.ts`
- `packages/trees-core/src/` (store.ts, projection.ts, helpers.ts) for how the schema is actually used

Review this data model against data-design best practices. Focus especially on **whether invalid states are representable** (make illegal states unrepresentable). Concretely evaluate:

- **Invalid states:** Can the types express combinations that should never occur? (e.g. a status that contradicts its timestamps, an `endedAt` with no `startedAt`, a "resolved" record missing its resolution, a discriminated field where the wrong sibling fields are present.)
- **Redundancy / drift:** Fields that duplicate derivable data and can fall out of sync (e.g. `statusSummary`/`metricsSummary` caches, cross-referenced IDs that restate a parent relationship, `path` vs `parentPath`).
- **Union / enum modeling:** Are status enums, `kind` discriminators, and optional sibling fields modeled so illegal combinations cannot be constructed? Should any be discriminated unions instead of a bag of optionals?
- **Nullability:** Fields that are optional but should be required (or vice versa) for a given state.
- **Referential integrity:** The many free-floating `id` string references (`entityId`, `workSessionId`, `agentRunId`, etc.) with no typing to prevent mixing ID kinds.
- **Temporal consistency:** `createdAt`/`updatedAt`/`startedAt`/`endedAt`/`resolvedAt` ordering invariants the types don't enforce.

Write your review to a new file `DATA_MODEL_REVIEW.md` at the repository root. Structure it as a prioritized list of findings. For each finding give: the specific type and field(s), the problem (with a concrete example of an invalid value the current types accept), and a concrete fix (a better type shape). Be specific and cite the actual types. End with a short summary of the 3 most important changes.
