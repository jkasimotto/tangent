# Quality Scorecard

Current architecture posture:
- Package map: present
- Dependency graph: documented and linted
- AGENTS routing: present for root, packages, and source directories
- Parser duplication: extracted to @tangent/core/cli
- Process runner duplication: extracted to @tangent/agent-runtime
- Repo discovery duplication: extracted to @tangent/repo
- Hook provider mechanics: extracted to @tangent/hooks

Review this scorecard after major package-boundary changes.
