# ADR-0001: Agent Legibility

Status: accepted

Decision: Tangent uses short AGENTS.md files as routing maps and keeps durable architecture knowledge in versioned docs.

Why: Agents need progressive disclosure. A short map preserves task context and points to the relevant system-of-record documents.

Consequences:
- Root AGENTS.md stays under 100 lines.
- Package and source AGENTS.md files stay short.
- Architecture rules that can be enforced should become governance lints.
