# User intent: build brain-presented declarative interfaces

Date: 2026-08-28. Source: Goal `otto/tangent/goal-build-brain-presented-declarative-interfaces.md`, assignment 1, as relayed by the brain.

## What Julian wants

- Area brains can present the approved first-version card kinds from `otto/tangent/design-brain-presented-interfaces.md`: `copy`, `link`, `links`, `progress`, `checklist`, `commits`, `reviews`.
- Agent Shell validates, persists, renders, navigates, dismisses, and accessibly exposes them on Work.
- A brain gets no arbitrary UI. A card changes no Goal state.
- Julian's own examples: progress of agents in a pipeline, messages to copy, links to open so he can verify, the commits of an Area, and Phabricator reviews he can click.

## Done when

Area brains can present the approved first-version declarative card kinds from `design-brain-presented-interfaces.md`. Agent Shell validates, persists, renders, navigates, dismisses, and accessibly exposes them on Work without allowing arbitrary UI or changing Goal state.

## Earlier words that bind this design

- 2026-08-28, comment on the product design, section 5 (three child rows per Goal, the fourth refused): "seems overly strict." The comment is open. The design does not enforce the cap on the server and keeps the cap as one constant.
- The approved product design, decision 9: "Reuse `tangent goal present` with `--card`, the same record folder, keys, and idempotence."
- The approved product design, section 3.5: no button that writes state. "Selection never starts work, and only Julian's word closes a Goal."
