# Observation Model

Observations model how facts are obtained.

Precedence:

1. Structured agent/provider events
2. Usage telemetry linked by env/session/worktree/time
3. Terminal runtime process lifecycle
4. Terminal output parsed by adapters
5. Git/worktree observations
6. User actions
7. Imported legacy pa files

Confidence decreases as sources get weaker.
