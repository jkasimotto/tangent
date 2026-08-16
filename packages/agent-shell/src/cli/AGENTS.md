# Agent Notes

Purpose: the `tangent area|goal|idea|agent|vault` CLI. `spec.ts` holds the help specs, `client.ts` the loopback HTTP client and tmux session lookup, `commands/` one file per noun.

Local rules: Every command but `vault commit` goes through the Agent Shell server; add new behaviour as a server endpoint plus a thin client call, never as local file or process logic here.

Read next:
- Package docs/index.md: ../../docs/index.md
- ../../docs/public-api.md
