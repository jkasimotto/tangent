import { homedir } from "node:os";
import path from "node:path";

import type { HookCommandOptions, HookScope } from "../types.js";
import { hookCommand } from "../config.js";

export const claudeHookEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "MessageDisplay",
  "InstructionsLoaded",
  "Notification",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionEnd"
] as const;

export function claudeHookPath(scope: HookScope, repoRoot?: string): string {
  if (scope === "global") return path.join(homedir(), ".claude", "settings.json");
  if (!repoRoot) throw new Error(`Claude ${scope} hook installation requires a repo path.`);
  if (scope === "repo-local") return path.join(repoRoot, ".claude", "settings.local.json");
  return path.join(repoRoot, ".claude", "settings.json");
}

export function claudeHooksConfig(options: Omit<HookCommandOptions, "provider">): Record<string, unknown> {
  return {
    hooks: Object.fromEntries(
      claudeHookEvents.map((event) => [
        event,
        [
          {
            ...(claudeNeedsMatcher(event) ? { matcher: "*" } : {}),
            hooks: [
              {
                type: "command",
                command: hookCommand({ ...options, provider: "claude" }),
                statusMessage: "Recording Tangent conversation event"
              }
            ]
          }
        ]
      ])
    )
  };
}

export function claudeNeedsMatcher(event: string): boolean {
  return !["UserPromptSubmit", "Stop", "SubagentStop"].includes(event);
}
