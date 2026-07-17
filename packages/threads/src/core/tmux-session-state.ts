import { runProcess } from "@tangent/agent-runtime/process";
import type { RegistryEntry, RuntimeStateReader, SessionState } from "./types.js";

export type TmuxStateRunner = (command: string, args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** Reads Pi completion from tmux's pane-dead flag. Dispatch enables remain-on-exit so output stays attachable. */
export class TmuxSessionStateReader implements RuntimeStateReader {
  constructor(private readonly run: TmuxStateRunner = (command, args) => runProcess({ command, args })) {}

  /** Maps the registered session's retained pane state to working, ended, or unknown. */
  async read(entry: RegistryEntry): Promise<SessionState | undefined> {
    const result = await this.run("tmux", ["display-message", "-p", "-t", entry.tmux, "#{pane_dead} #{pane_dead_status}"]);
    if (result.code !== 0) return { status: "unknown", idleMs: 0 };
    const [dead] = result.stdout.trim().split(/\s+/);
    return { status: dead === "1" ? "ended" : "active", idleMs: 0, lastStepKind: "other" };
  }
}
