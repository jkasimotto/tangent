import { runProcess } from "@tangent/agent-runtime/process";
import type { AttachProcessRunner } from "./attach.js";

/**
 * Puts rich text on the macOS clipboard with two flavors: HTML (so pasting into Slack keeps bold
 * and code blocks) and plain text (so plain fields still work). Uses AppleScript's
 * `set the clipboard to {«class HTML»:..., «class utf8»:...}` record, with the HTML hex-encoded
 * into the script and the script fed to osascript via stdin so nothing needs shell quoting. The
 * runner is injectable so tests never spawn osascript.
 */
export async function setClipboardRich(html: string, plain: string, run: AttachProcessRunner = defaultRunner): Promise<void> {
  const hex = Buffer.from(html, "utf8").toString("hex");
  const script = [
    `set plainText to "${escapeAppleScriptString(plain)}"`,
    `set the clipboard to {«class HTML»:«data HTML${hex}», «class utf8»:plainText}`
  ].join("\n");
  const result = await run("osascript", [], script);
  if (result.code !== 0) {
    throw new Error(`osascript failed setting the clipboard (exit ${result.code}): ${result.stderr.trim()}`);
  }
}

/** Escapes a string for an AppleScript double-quoted literal: backslashes, quotes, and newlines (AppleScript string literals cannot span source lines). */
function escapeAppleScriptString(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "").replaceAll("\n", "\\n");
}

/** Default runner: a real osascript via @tangent/agent-runtime, capped so a hung osascript cannot hang the CLI. */
const defaultRunner: AttachProcessRunner = (command, args, stdin) => runProcess({ command, args, stdin, timeoutMs: 15000 });
