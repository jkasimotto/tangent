#!/usr/bin/env node
/**
 * file-read-analysis.mjs
 *
 * Uses the Tangent Usage API to analyse file-read patterns in coding-agent
 * conversations for a given repo and date.
 *
 * Outputs:
 *   1. Distribution of files read (count per file)
 *   2. Estimated time "spent reading" each file, calculated as the time from
 *      each Read tool-call until the next event in the same session.
 *
 * Usage:
 *   node file-read-analysis.mjs [--repo ~/Projects/polez] [--date 2026-07-10]
 *                               [--model claude-fable-5] [--top 20]
 *
 * Options:
 *   --repo <path>     Repository to analyse (default: ~/Projects/polez)
 *   --date <YYYY-MM-DD>  Date to analyse (default: today, UTC)
 *   --model <name>    Filter to a specific model (e.g. claude-fable-5)
 *   --top <n>         Number of files to show (default: 25)
 *   --json            Output raw JSON instead of a formatted table
 */

import { openUsageFromSqlite } from "@tangent/usage";
import { homedir } from "os";
import { resolve } from "path";

// ─── CLI args ───────────────────────────────────────────────────────────────

/** Parses the CLI flags documented in --help into an options object. */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo: null,
    scope: "repo",
    date: new Date().toISOString().slice(0, 10),
    model: null,
    top: 25,
    json: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--repo":   opts.repo = args[++i]; break;
      case "--scope":  opts.scope = args[++i]; break;
      case "--all":    opts.scope = "all"; opts.repo = null; break;
      case "--date":   opts.date = args[++i]; break;
      case "--model":  opts.model = args[++i]; break;
      case "--top":    opts.top = parseInt(args[++i], 10); break;
      case "--json":   opts.json = true; break;
      case "--help": case "-h":
        console.log(`Usage: node file-read-analysis.mjs [options]

Options:
  --repo <path>       Repository to analyse (default: ~/Projects/polez)
  --scope all         Query the global index across all repos
  --all               Shorthand for --scope all
  --date <YYYY-MM-DD> Date to analyse (default: today)
  --model <name>      Filter to a specific model
  --top <n>           Number of files to show (default: 25)
  --json              Output raw JSON`);
        process.exit(0);
    }
  }
  if (!opts.repo && opts.scope !== "all") {
    opts.repo = resolve(homedir(), "Projects/polez");
  }
  return opts;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Formats a duration in milliseconds as 850ms, 2.3s, or 4m12s for the report. */
function msToFriendly(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/** Truncates a path from the left so the filename always survives table width. */
function shortenPath(path, maxLen = 70) {
  if (!path) return "(unknown)";
  if (path.length <= maxLen) return path;
  // Keep the filename and as much of the dir prefix as fits
  const parts = path.split("/");
  const filename = parts.pop();
  let result = filename;
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i] + "/" + result;
    if (candidate.length > maxLen - 3) {
      return "..." + result;
    }
    result = candidate;
  }
  return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** Runs the analysis: queries Read tool calls for the day and prints both reports. */
async function main() {
  const opts = parseArgs();

  const dayStart = new Date(opts.date + "T00:00:00.000Z");
  const dayEnd = new Date(opts.date + "T23:59:59.999Z");

  console.error(`Querying Usage API${opts.scope === "all" ? " (global)" : ` for ${opts.repo}`} on ${opts.date}${opts.model ? ` (model: ${opts.model})` : ""}...`);

  const clientOpts = {
    from: dayStart.toISOString(),
    to: dayEnd.toISOString(),
  };
  if (opts.scope === "all") {
    clientOpts.scope = "all";
  } else {
    clientOpts.repo = opts.repo;
  }

  const usage = await openUsageFromSqlite(clientOpts);

  // Fetch all events for the date window
  const eventsResult = await usage.raw.events({ limit: 1_000_000 });
  const allEvents = eventsResult.data;

  console.error(`  Loaded ${allEvents.length} events.`);

  // Fetch all tool calls
  const toolsResult = await usage.tools.query({ includeResults: "none", limit: 1_000_000 });
  const allToolCalls = toolsResult.data;

  console.error(`  Loaded ${allToolCalls.length} tool calls.`);

  // Filter to read-category tool calls (Read, read_file)
  const readTools = allToolCalls.filter(
    (tc) => tc.category === "read" || tc.toolName === "Read" || tc.toolName === "read_file"
  );

  // Optionally filter by model
  const filteredReads = opts.model
    ? readTools.filter((tc) => tc.model === opts.model)
    : readTools;

  console.error(`  ${filteredReads.length} read tool calls${opts.model ? ` (model: ${opts.model})` : ""}.`);

  // ── Build per-session event timelines for time-gap calculation ──
  // Group all events by session, sorted by observedAt
  const sessions = new Map(); // sessionId -> sorted event[]
  for (const evt of allEvents) {
    const sid = evt.scope?.sessionId;
    if (!sid) continue;
    const ts = evt.observedAt || evt.recordedAt;
    if (!ts) continue;
    if (!sessions.has(sid)) sessions.set(sid, []);
    sessions.get(sid).push({ ts: new Date(ts).getTime(), evt });
  }
  for (const arr of sessions.values()) {
    arr.sort((a, b) => a.ts - b.ts);
  }

  // ── Build a lookup from tool call ID to its observedAt ──
  // Tool calls in the tools.query result don't have timestamps directly,
  // so we find them in the raw events by toolCallId.
  const toolCallTimestamps = new Map(); // toolCallId -> { callTs, sessionId }
  for (const evt of allEvents) {
    if (evt.kind === "tool.call") {
      const tcId = evt.scope?.toolCallId;
      if (!tcId) continue;
      const ts = evt.observedAt || evt.recordedAt;
      if (!ts) continue;
      toolCallTimestamps.set(tcId, {
        callTs: new Date(ts).getTime(),
        sessionId: evt.scope?.sessionId,
      });
    }
  }

  // ── For each read, extract file path and calculate time to next event ──
  const fileStats = new Map(); // filePath -> { count, totalMs, sessions: Set, models: Set }

  for (const tc of filteredReads) {
    // Extract file path
    let filePath = null;
    if (tc.input && typeof tc.input === "object" && tc.input.file_path) {
      filePath = tc.input.file_path;
    } else if (tc.targetPaths && tc.targetPaths.length > 0) {
      filePath = tc.targetPaths[0];
    }
    if (!filePath) continue;

    // Find the timestamp for this tool call
    const tcInfo = toolCallTimestamps.get(tc.id);
    if (!tcInfo) continue;

    const { callTs, sessionId } = tcInfo;

    // Find the next event in the same session after this tool call
    const sessionEvents = sessions.get(sessionId);
    if (!sessionEvents) continue;

    // Binary search for the first event after callTs
    let nextEventTs = null;
    for (const se of sessionEvents) {
      if (se.ts > callTs) {
        nextEventTs = se.ts;
        break;
      }
    }

    const gapMs = nextEventTs ? nextEventTs - callTs : 0;

    // Aggregate
    if (!fileStats.has(filePath)) {
      fileStats.set(filePath, { count: 0, totalMs: 0, sessions: new Set(), models: new Set(), maxGap: 0 });
    }
    const stats = fileStats.get(filePath);
    stats.count++;
    stats.totalMs += gapMs;
    stats.sessions.add(sessionId);
    if (tc.model) stats.models.add(tc.model);
    if (gapMs > stats.maxGap) stats.maxGap = gapMs;
  }

  // ── Sort by total time spent ──
  const sorted = [...fileStats.entries()]
    .map(([path, stats]) => ({
      path,
      count: stats.count,
      totalMs: stats.totalMs,
      avgMs: stats.count > 0 ? stats.totalMs / stats.count : 0,
      maxMs: stats.maxGap,
      sessions: stats.sessions.size,
      models: [...stats.models].join(", "),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // ── Output ──
  const totalReads = sorted.reduce((sum, r) => sum + r.count, 0);
  const totalTime = sorted.reduce((sum, r) => sum + r.totalMs, 0);
  const uniqueFiles = sorted.length;

  if (opts.json) {
    console.log(JSON.stringify({
      date: opts.date,
      repo: opts.repo || "(global)",
      scope: opts.scope,
      model: opts.model,
      summary: {
        totalReads,
        uniqueFiles,
        totalTimeMs: totalTime,
        totalTimeFriendly: msToFriendly(totalTime),
      },
      files: sorted,
    }, null, 2));
    return;
  }

  // Formatted table
  console.log("");
  console.log(`  File Read Analysis — ${opts.date}${opts.model ? ` (${opts.model})` : ""}`);
  console.log(`  ${"─".repeat(100)}`);
  console.log(`  Total reads: ${totalReads}  |  Unique files: ${uniqueFiles}  |  Total "read time": ${msToFriendly(totalTime)}`);
  console.log("");

  const top = sorted.slice(0, opts.top);

  if (top.length === 0) {
    console.log("  No file reads found for the given criteria.");
    return;
  }

  // Table header
  const header = `  ${"#".padStart(3)}  ${"Reads".padStart(5)}  ${"Total".padStart(7)}  ${"Avg".padStart(7)}  ${"Max".padStart(7)}  ${"Sess".padStart(4)}  File`;
  console.log(header);
  console.log(`  ${"─".repeat(100)}`);

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const num = String(i + 1).padStart(3);
    const reads = String(r.count).padStart(5);
    const total = msToFriendly(r.totalMs).padStart(7);
    const avg = msToFriendly(r.avgMs).padStart(7);
    const max = msToFriendly(r.maxMs).padStart(7);
    const sess = String(r.sessions).padStart(4);
    const file = shortenPath(r.path, 60);
    console.log(`  ${num}  ${reads}  ${total}  ${avg}  ${max}  ${sess}  ${file}`);
  }

  if (sorted.length > opts.top) {
    console.log(`  ${"─".repeat(100)}`);
    console.log(`  ... and ${sorted.length - opts.top} more files`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
