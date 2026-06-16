# @tangent/trees-server Architecture

Trees server registers Trees browser assets for the combined Tangent UI and exposes local `/api/trees/*` JSON routes backed by the filesystem Trees event store.

The V1 API returns a compact workspace DTO with entities and projects, creates missing group-ready path segments, saves selected nodes as work leaves, and clears leaf metadata through full entity replacement events.
