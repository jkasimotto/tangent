export type CodexHookEvent =
  | CodexSessionStart
  | CodexUserPromptSubmit
  | CodexPreToolUse
  | CodexPermissionRequest
  | CodexPostToolUse
  | CodexCompact
  | CodexSubagentStart
  | CodexSubagentStop
  | CodexStop
  | CodexCommonHookInput;

export type CodexCommonHookInput = {
  session_id: string;
  transcript_path: string | null;
  cwd: string;
  hook_event_name: string;
  model: string;
  permission_mode?: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
};

export type CodexSessionStart = CodexCommonHookInput & {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
};

export type CodexUserPromptSubmit = CodexCommonHookInput & {
  hook_event_name: "UserPromptSubmit";
  turn_id: string;
  prompt: string;
};

export type CodexPreToolUse = CodexCommonHookInput & {
  hook_event_name: "PreToolUse";
  turn_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
};

export type CodexPermissionRequest = CodexCommonHookInput & {
  hook_event_name: "PermissionRequest";
  turn_id: string;
  tool_name: string;
  tool_input: unknown & { description?: string | null };
};

export type CodexPostToolUse = CodexCommonHookInput & {
  hook_event_name: "PostToolUse";
  turn_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response: unknown;
};

export type CodexCompact = CodexCommonHookInput & {
  hook_event_name: "PreCompact" | "PostCompact";
  turn_id: string;
  trigger: "manual" | "auto";
};

export type CodexSubagentStart = CodexCommonHookInput & {
  hook_event_name: "SubagentStart";
  turn_id: string;
  agent_id: string;
  agent_type: string;
};

export type CodexSubagentStop = CodexCommonHookInput & {
  hook_event_name: "SubagentStop";
  turn_id: string;
  agent_id: string;
  agent_type: string;
  agent_transcript_path: string | null;
  stop_hook_active: boolean;
  last_assistant_message: string | null;
};

export type CodexStop = CodexCommonHookInput & {
  hook_event_name: "Stop";
  turn_id: string;
  stop_hook_active: boolean;
  last_assistant_message: string | null;
};
