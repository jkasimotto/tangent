# @tangent/usage-providers Architecture

Provider-native parsing and loading belongs here, not in `usage-schema` or `usage-core`.

Claude native capture is verbatim: tool input and output are stored without redaction or truncation, assistant `thinking` blocks are extracted, and `ExitPlanMode` is categorized as `plan` with its `input.plan` markdown preserved. Codex native capture still redacts. See ADR-0010.
