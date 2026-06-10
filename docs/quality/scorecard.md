# Quality Scorecard

Current architecture posture:
- Package map: present
- Dependency graph: documented and linted
- AGENTS routing: present for root, packages, and source directories
- Parser duplication: extracted to @tangent/core/cli
- Process runner duplication: extracted to @tangent/agent-runtime
- Repo discovery duplication: extracted to @tangent/repo
- Hook capture: retired; native transcript indexing is the usage source of truth

Review this scorecard after major package-boundary changes.
