# @tangent/tangent-ui Docs

Purpose: combined UI shell for installed Tangent apps.

The shell runs a build-freshness loop: it polls `/api/version`, silently reloads into a new build (deferred while a text input is focused or the feedback composer is dirty), and shows a passive "Updated <relative time>" label anchored inside the app-switcher node so it rides into `/trees` where the chrome is hidden.

Read next:
- architecture.md
- public-api.md
