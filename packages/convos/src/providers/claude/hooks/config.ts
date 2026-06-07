import path from "node:path";
import { homedir } from "node:os";

import type { CaptureScope } from "../../../core/schema/convos-jsonl-v1.js";

export const claudeHookEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "MessageDisplay",
  "PreToolUse",
  "PostToolUse",
  "SessionEnd"
] as const;

export function claudeHookPath(scope: CaptureScope, repoRoot?: string): string {
  if (scope === "global") return path.join(homedir(), ".claude", "settings.json");
  if (!repoRoot) throw new Error(`Claude ${scope} hook installation requires a repo path.`);
  if (scope === "repo-local") return path.join(repoRoot, ".claude", "settings.local.json");
  return path.join(repoRoot, ".claude", "settings.json");
}

export function claudeHooksConfig(scope: CaptureScope): Record<string, unknown> {
  return {
    hooks: Object.fromEntries(
      claudeHookEvents.map((event) => [
        event,
        [
          {
            ...(needsMatcher(event) ? { matcher: "*" } : {}),
            hooks: [
              {
                type: "command",
                command: `tangent convos hook record --provider claude --scope ${scope}`,
                ...(event === "MessageDisplay" ? { timeout: 3 } : {})
              }
            ]
          }
        ]
      ])
    )
  };
}

function needsMatcher(event: string): boolean {
  return ["SessionStart", "PreToolUse", "PostToolUse", "SessionEnd"].includes(event);
}
