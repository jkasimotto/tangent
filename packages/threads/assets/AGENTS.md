# Agent Notes

Purpose: Non-code assets shipped with @tangent/threads, e.g. the launchd template for scheduling `tangent threads recur due`.

Local rules:
- Assets here are data files, not source; keep them free of machine-specific values beyond what the docs call out (the plist's node/tangent binary paths and log path are illustrative and meant to be adjusted per machine).
- Listed in package.json's `files` array so the published package includes this directory.

Read next:
- ../docs/index.md
- ../docs/public-api.md
