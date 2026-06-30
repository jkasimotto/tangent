# Agent Notes

Purpose: Gemini CLI native chat-session discovery, reading, and normalization helpers.

Local rules:
- Handle both on-disk formats: a single JSON document (session-*.json) and JSONL (session-*.jsonl). The reader flattens both to one record shape.
- Resolve the working directory from the session's projectHash via ~/.gemini/projects.json (sha256(cwd)), falling back to the directory name.
- Keep parsing permissive; native Gemini sessions carry no CLI version.

Read next:
- ../../../../docs/index.md
