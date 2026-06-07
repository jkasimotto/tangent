import path from "node:path";
import { homedir } from "node:os";

import type { CaptureScope } from "../../../core/schema/convos-jsonl-v1.js";

export const codexHookEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop"
] as const;

export function codexHookPath(scope: CaptureScope, repoRoot?: string): string {
  if (scope === "global") return path.join(homedir(), ".codex", "hooks.json");
  if (!repoRoot) throw new Error(`Codex ${scope} hook installation requires a repo path.`);
  return path.join(repoRoot, ".codex", "hooks.json");
}

export function codexHooksConfig(scope: CaptureScope): Record<string, unknown> {
  return {
    hooks: Object.fromEntries(
      codexHookEvents.map((event) => [
        event,
        [
          {
            ...(needsMatcher(event) ? { matcher: "*" } : {}),
            hooks: [
              {
                type: "command",
                command: `tangent convos hook record --provider codex --scope ${scope}`
              }
            ]
          }
        ]
      ])
    )
  };
}

function needsMatcher(event: string): boolean {
  return !["UserPromptSubmit", "Stop", "PreCompact", "PostCompact"].includes(event);
}
