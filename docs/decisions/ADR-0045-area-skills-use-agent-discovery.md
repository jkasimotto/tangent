# ADR-0045: Area skills use agent discovery

Date: 2026-08-28

Status: accepted

## Context

Area skills used `skill-<slug>.md` Documents. Agent harnesses did not discover
those files as skills. Codex and Claude also required different project paths.

## Decision

The canonical Area skill is
`<area>/.agents/skills/<name>/SKILL.md`.

Tangent creates `<area>/.claude/skills` as a relative link to
`../.agents/skills`. It creates the same link at the vault root. Codex reads
the canonical path. Claude reads the linked path. Both harnesses inherit skills
from the vault root to the current Area.

`tangent area show` reads canonical skills on that route. It also reads
existing `skill-<slug>.md` Documents. If both formats define the same name in
one Area, the canonical skill wins.

Workers start in work repositories. They do not inherit vault skills. A brain
must give a worker the absolute `SKILL.md` path in its instruction.

This decision amends D20 in the Agent Shell operating vision.

## Consequences

- One file supplies both Codex and Claude.
- Dot folders do not become Areas or Documents.
- Existing skill Documents continue to work during migration.
- New Area skills must use the canonical agent skill directory.
