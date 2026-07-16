# Agent Notes

Purpose: @tangent/threads tests.

Local rules:
- Import from `../dist/*`, never `../src/*`; tests run against the built package.
- Isolate every test with `mkdtemp` plus `TANGENT_TREES_DIR` (vault root) and `TANGENT_HOME` (sidecar location, since `tangentHome()` honors it). Never touch the real `~/.tangent`.
- Fake `SessionStateReader`, `WhyLineRunner`, and `Notifier` implementations instead of touching SQLite, spawning `claude`, or spawning `terminal-notifier`.

Read next:
- ../docs/index.md
