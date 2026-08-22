# Agent Notes

Purpose: the `tangent area|goal|idea|agent|vault|study` CLI. `spec.ts` holds the help specs, `client.ts` the loopback HTTP client and tmux session lookup, `commands/` one file per noun.

Local rules: Every command but `vault commit` and `study` goes through the Agent Shell server; add new behaviour as a server endpoint plus a thin client call, never as local file or process logic here. `study` spawns the local interactive partner session (ADR-0026).

Read next:
- Package docs/index.md: ../../docs/index.md
- ../../docs/public-api.md
