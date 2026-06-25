# @tangent/ui-server Docs

Purpose: shared local UI server used by eval, usage, rollup, and combined Tangent apps.

`readBuildIdentity(rootDir)` derives a `{ buildId, builtAt }` from the served asset bundle so a long-lived client can poll a `/api/version` route and reload into a new build. The id is a hash of the asset manifest, so it changes whenever a new build lands on disk; the route owner maps a read failure to a 500 so the client fails quiet.

Read next:
- architecture.md
- public-api.md
