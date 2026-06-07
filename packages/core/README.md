# @tangent/core

Shared command metadata, help rendering, and shell completion helpers for `tangent`.

Command-owning packages export a `CliCommandSpec`. The root `tangent` CLI registers those specs once, then help and tab completion are derived from the same tree.

```bash
tangent completion zsh
tangent completion bash
tangent completion fish
```
