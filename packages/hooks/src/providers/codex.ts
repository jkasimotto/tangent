import { homedir } from "node:os";
import path from "node:path";

import type { HookCommandOptions, HookScope } from "../types.js";
import { hookCommand } from "../config.js";

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

export function codexHookPath(scope: HookScope, repoRoot?: string): string {
  if (scope === "global") return path.join(homedir(), ".codex", "hooks.json");
  if (!repoRoot) throw new Error(`Codex ${scope} hook installation requires a repo path.`);
  return path.join(repoRoot, ".codex", "hooks.json");
}

export function codexHooksConfig(options: Omit<HookCommandOptions, "provider">): Record<string, unknown> {
  return {
    hooks: Object.fromEntries(
      codexHookEvents.map((event) => [
        event,
        [
          {
            ...(codexNeedsMatcher(event) ? { matcher: "*" } : {}),
            hooks: [
              {
                type: "command",
                command: hookCommand({ ...options, provider: "codex" }),
                statusMessage: "Recording Tangent conversation event"
              }
            ]
          }
        ]
      ])
    )
  };
}

export function codexNeedsMatcher(event: string): boolean {
  return !["UserPromptSubmit", "Stop", "PreCompact", "PostCompact"].includes(event);
}
