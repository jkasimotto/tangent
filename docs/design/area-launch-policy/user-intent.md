# Area launch policy: user intent

Date: 2026-08-28

This note keeps Julian's request as the brain relayed it, before the design turns it into schema and code.

## Julian's words, condensed

- Replace the current default harness/model/effort concept.
- Harnesses and models are scoped to Areas. `neara` and `otto` can allow different choices.
- Neither Agent Shell, Area brains, nor Tangent CLI commands can launch an agent with a choice from the other scope.
- Instead of configured brain and worker defaults, remember the last-used valid harness/model/effort and offer that next time.
- UI filtering is never the only guard.

## Done when (from the Goal)

Each Area declares or inherits the harness/model/effort choices allowed within its subtree. Agent Shell, brains, and the Tangent CLI reject disallowed cross-Area launches. Launch selectors remember the last valid choice per Area instead of separate brain and worker defaults. Migration and focused verification cover Otto and Neara isolation.
