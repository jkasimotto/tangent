# Agent Runtime Architecture

@tangent/agent-runtime owns shared process execution:
- command, args, cwd, stdin, stdout, stderr
- timeout handling
- environment merging
- process failure formatting
- runner JSON parsing helpers
- Claude, Codex, and Gemini command adapters
- fresh provider sessions and supported session resume operations
- structured completion and provider session identifiers

Rollup, Eval, and Agent Shell keep their domain prompts, schemas, manifests, and output validation. Shared provider command behavior belongs in agent-runtime.

A saved agent preset can request a login shell. This option supports local aliases without teaching a vertical app how to start a provider.
