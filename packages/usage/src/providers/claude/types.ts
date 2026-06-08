export type ClaudeHookEvent = ClaudeCommonHookInput & Record<string, unknown>;

export type ClaudeCommonHookInput = {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: string;
  effort?: string;
  hook_event_name: string;
};
