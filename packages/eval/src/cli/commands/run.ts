import path from "node:path";

import { booleanArg, stringArg, stringsArg, type Args } from "../args.js";
import { loadEvalSpec, resolveVariants } from "../../core/config.js";
import { collectEval } from "../../core/metrics.js";
import { runPreparedEval } from "../../core/run.js";
import { prepareEval } from "../../core/worktree.js";
import type { LoadedEvalSpec } from "../../core/config.js";
import type { EvalRunProgressEvent } from "../../core/run.js";
import type { PrepareEvalProgressEvent } from "../../core/worktree.js";
import type { EvalSpec } from "../../types/spec.js";
import { agentFromArgs, contextsFromArgs, phasesFromArgs, variantIdFromContext } from "./shared.js";

/** Handles the `eval run` subcommand, running an eval spec end-to-end. */
export async function runCommand(args: Args): Promise<void> {
  const specPath = stringArg(args._[1]);
  const loaded = specPath ? await loadEvalSpec(specPath) : await shortcutLoadedSpec(args);
  const progress = booleanArg(args.json) ? undefined : createProgressPrinter();
  try {
    const prepared = await prepareEval(loaded, { onProgress: progress?.prepare });
    await runPreparedEval(prepared.manifest, { onProgress: progress?.run });
    progress?.collect(prepared.manifest.id, "started");
    const collected = await collectEval(prepared.manifest);
    progress?.collect(prepared.manifest.id, "done");
    if (booleanArg(args.json)) {
      console.log(JSON.stringify({ run: collected.manifest, metrics: collected.metrics }, null, 2));
      return;
    }
    console.log(`run: ${collected.manifest.id}`);
    console.log(`dir: ${collected.manifest.runDir}`);
  } finally {
    progress?.stop();
  }
}

/** Builds a LoadedEvalSpec from --prompt/--context shortcut flags without an eval.json file. */
async function shortcutLoadedSpec(args: Args): Promise<LoadedEvalSpec> {
  const prompts = stringsArg(args.prompt);
  if (prompts.length === 0) throw new Error("eval run shortcut mode requires --prompt <path>; otherwise pass <eval.json>.");
  const contexts = contextsFromArgs(args);
  const invocationCwd = process.cwd();
  const cases = prompts.map((promptPath, promptIndex) => ({
    id: caseIdFromPrompt(promptPath, promptIndex),
    prompt: promptPath,
    variants: contexts.map((context, contextIndex) => ({
      id: context.mode === "snapshot" ? variantIdFromContext(context.ref) : context.mode === "git-ref" ? `git-ref-${contextIndex + 1}` : variantIdFromContext(context.mode),
      context
    }))
  }));
  const spec: EvalSpec = {
    schema: "eval.spec.v1",
    name: "eval-run",
    defaults: {
      repo: {
        path: stringArg(args["repo-path"]) || ".",
        ref: stringArg(args.repo) || "HEAD"
      },
      cwd: stringArg(args.cwd) || ".",
      agent: agentFromArgs(args),
      phases: phasesFromArgs(args.phases)
    },
    cases
  };
  return {
    spec,
    specDir: invocationCwd,
    invocationCwd,
    variants: await resolveVariants(spec, { specDir: invocationCwd, invocationCwd })
  };
}

/** Derives a URL-safe case id from a prompt file path, falling back to a numbered label. */
function caseIdFromPrompt(promptPath: string, index: number): string {
  const name = path.basename(promptPath, path.extname(promptPath)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || `prompt-${index + 1}`;
}

/** Creates a progress printer that logs prepare, run, and collect lifecycle events to stdout. */
function createProgressPrinter(): {
  prepare(event: PrepareEvalProgressEvent): void;
  run(event: EvalRunProgressEvent): void;
  collect(runId: string, status: "started" | "done"): void;
  stop(): void;
} {
  const active = new Map<string, { label: string; startedAt: number }>();
  const heartbeat = setInterval(() => {
    if (active.size === 0) return;
    const rows = [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
    const preview = rows.slice(0, 3)
      .map((row) => `${row.label} (${formatElapsed(Date.now() - row.startedAt)})`)
      .join(", ");
    const remaining = rows.length > 3 ? `, +${rows.length - 3} more` : "";
    console.log(`still running: ${preview}${remaining}`);
  }, 30000);
  heartbeat.unref();

  return {
    /** Logs prepare lifecycle events to stdout. */
    prepare(event) {
      if (event.type === "prepare.started") console.log(`prepare: ${event.runId}`);
      if (event.type === "prepare.variant.started" && event.caseId && event.variantId) {
        active.set(activeKey("prepare", event.caseId, event.variantId), { label: `prepare ${event.caseId}/${event.variantId}`, startedAt: Date.now() });
        console.log(`prepare: ${event.caseId}/${event.variantId}`);
      }
      if (event.type === "prepare.variant.completed" && event.caseId && event.variantId) {
        console.log(`prepared: ${event.caseId}/${event.variantId}`);
        active.delete(activeKey("prepare", event.caseId, event.variantId));
      }
      if (event.type === "prepare.completed") console.log("prepare: done");
    },
    /** Logs run lifecycle events to stdout. */
    run(event) {
      if (event.type === "run.started") console.log(`run: ${event.runId}`);
      if (event.type === "variant.started" && event.caseId && event.variantId) {
        console.log(`variant: ${event.caseId}/${event.variantId}`);
      }
      if (event.type === "phase.started" && event.caseId && event.variantId && event.phase) {
        active.set(activeKey("phase", event.caseId, event.variantId, event.phase), { label: `${event.caseId}/${event.variantId} ${event.phase}`, startedAt: Date.now() });
        console.log(`phase: ${event.caseId}/${event.variantId} ${event.phase}`);
      }
      if (event.type === "phase.completed" && event.caseId && event.variantId && event.phase) {
        console.log(`phase done: ${event.caseId}/${event.variantId} ${event.phase}`);
        active.delete(activeKey("phase", event.caseId, event.variantId, event.phase));
      }
      if ((event.type === "phase.failed" || event.type === "phase.cancelled") && event.caseId && event.variantId && event.phase) {
        console.log(`${event.type === "phase.cancelled" ? "cancelled" : "failed"}: ${event.caseId}/${event.variantId} ${event.phase} - ${event.message || ""}`.trim());
        active.delete(activeKey("phase", event.caseId, event.variantId, event.phase));
      }
      if (event.type === "variant.completed" && event.caseId && event.variantId) console.log(`variant done: ${event.caseId}/${event.variantId}`);
      if ((event.type === "variant.failed" || event.type === "variant.cancelled") && event.caseId && event.variantId) {
        clearVariant(active, event.caseId, event.variantId);
      }
      if (event.type === "run.completed") console.log("run: done");
      if (event.type === "run.cancelled") console.log(`run: cancelled${event.message ? ` - ${event.message}` : ""}`);
    },
    /** Logs collect lifecycle events to stdout. */
    collect(runId, status) {
      console.log(status === "started" ? `collect: ${runId}` : "collect: done");
    },
    /** Clears the heartbeat timer. */
    stop() {
      clearInterval(heartbeat);
    }
  };
}

/** Builds a unique map key for an in-flight prepare or phase entry. */
function activeKey(kind: "prepare" | "phase", caseId: string, variantId: string, phase = ""): string {
  return `${kind}:${caseId}:${variantId}:${phase}`;
}

/** Removes all active entries for a given case and variant from the in-flight map. */
function clearVariant(active: Map<string, { label: string; startedAt: number }>, caseId: string, variantId: string): void {
  const marker = `:${caseId}:${variantId}:`;
  for (const key of active.keys()) {
    if (key.includes(marker) || key === activeKey("prepare", caseId, variantId)) active.delete(key);
  }
}

/** Formats elapsed milliseconds as a human-readable duration string. */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${seconds}s`;
}
