import { runProcess } from "@tangent/agent-runtime/process";
import type { Notifier } from "./types.js";

/** Fires a macOS `terminal-notifier` alert for one thread newly needing attention. */
export class TerminalNotifier implements Notifier {
  /** Fires one terminal-notifier alert; best-effort, no retry (the sweep only calls this for newly-attention-needing threads). */
  async notify(input: { title: string; message: string }): Promise<void> {
    await runProcess({
      command: "terminal-notifier",
      args: ["-title", input.title, "-message", input.message],
      timeoutMs: 5000
    });
  }
}
