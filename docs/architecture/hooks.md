# Hooks Architecture

@tangent/hooks owns provider mechanics:
- provider hook event catalogs
- hook config paths
- matcher rules
- hook command construction
- config merge/remove
- install/uninstall/status
- repo-local git exclude behavior

@convos/convos owns telemetry interpretation:
- provider raw hook input to Convos events
- Convos raw-hook persistence
- Convos event schema and dataset model
- tracking policy and redaction choices

The hook record command is injectable so @tangent/hooks does not depend on Convos. Today Convos installs hooks with tangent convos hook record; future shared raw hook dispatch can move to tangent hooks record without changing provider config code.
