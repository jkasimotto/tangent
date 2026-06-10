# Agent Runtime Architecture

@tangent/agent-runtime owns shared process execution:
- command, args, cwd, stdin, stdout, stderr
- timeout handling
- environment merging
- process failure formatting
- runner JSON parsing helpers

Rollup and Eval keep their domain prompts, schemas, manifests, and output normalization. Shared timeout/env behavior belongs in agent-runtime so agents do not copy runner wrappers into vertical apps.
