# Hooks Architecture

@tangent/hooks owns provider mechanics:
- provider hook event catalogs
- hook config paths
- matcher rules
- hook command construction
- config merge/remove
- install/uninstall/status
- repo-local git exclude behavior

@tangent/usage owns telemetry interpretation:
- provider raw hook input to Usage events
- Usage raw-hook persistence
- Usage event schema and dataset model
- tracking policy and redaction choices

The hook record command is injectable so @tangent/hooks does not depend on Usage. Today Usage installs hooks with tangent usage hook record; future shared raw hook dispatch can move to tangent hooks record without changing provider config code.
