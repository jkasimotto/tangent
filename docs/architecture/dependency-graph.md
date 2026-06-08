# Dependency Graph

```text
root CLI
  -> @convos/convos/cli
  -> @tangent/daily/cli
  -> @tangent/eval/cli
  -> @tangent/search/cli
  -> @tangent/governance/cli

@tangent/daily -> @convos/convos, @tangent/core, @tangent/repo, @tangent/agent-runtime
@tangent/eval -> @convos/convos, @tangent/core, @tangent/repo, @tangent/agent-runtime
@convos/convos -> @tangent/core, @tangent/repo, @tangent/hooks
@tangent/search -> @tangent/core, @tangent/repo
@tangent/hooks -> @tangent/core, @tangent/repo
@tangent/repo -> @tangent/core
@tangent/agent-runtime -> @tangent/core
@tangent/governance -> @tangent/core
@tangent/core -> none
```

The graph is enforced by @tangent/governance. If a package dependency changes, update this file and the lint allowlist in the same change.
