#!/usr/bin/env node
// Pulls Otto Launcher's Trace voice-memo transcripts from the last 24h off a plugged-in phone and files
// them as a dated note in the tangent vault (~/.tangent/trees/otto/voice-memos/). Trace already transcribes
// memos on-device via Groq and stores the text in trace.db, so this just reads that: pull the sqlite file
// (+ WAL/SHM for a consistent read) via `adb run-as` (works because the app is a debug build), query
// voice_memo, and discard the local db copy afterwards. Requires the phone connected via USB with
// debugging authorized; tells you plainly if it isn't rather than failing silently.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const VAULT = join(HOME, ".tangent", "trees");
const NODE_DIR = join(VAULT, "otto", "voice-memos");
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PACKAGE = "com.otto.launcher";

/** Locates the adb binary via env vars, the default SDK path, or PATH. */
function findAdb() {
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    join(HOME, "Library", "Android", "sdk", "platform-tools", "adb"),
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "pipe" });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Returns the connected device's serial, or null if none; throws if one is present but unauthorized. */
function getConnectedDevice(adb) {
  const out = execFileSync(adb, ["devices"], { encoding: "utf8" });
  const lines = out.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  const device = lines.find((l) => l.endsWith("\tdevice"));
  if (device) return device.split("\t")[0];
  const unauthorized = lines.find((l) => l.endsWith("\tunauthorized"));
  if (unauthorized) throw new Error("Phone is connected but unauthorized: accept the USB debugging prompt on the device.");
  return null;
}

/** Copies trace.db (and its WAL/SHM if present) off the device into a fresh temp dir via run-as. */
function pullTraceDb(adb) {
  const dir = mkdtempSync(join(tmpdir(), "trace-db-"));
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      const bytes = execFileSync(adb, ["exec-out", "run-as", PACKAGE, "cat", `databases/trace.db${suffix}`], {
        maxBuffer: 1024 * 1024 * 256,
      });
      if (bytes.length > 0) writeFileSync(join(dir, `trace.db${suffix}`), bytes);
    } catch (err) {
      if (suffix === "") throw new Error(`Could not read trace.db via run-as: ${err.message}`);
      // -wal/-shm are optional (may not exist if the db is fully checkpointed)
    }
  }
  return dir;
}

/** Reads voice_memo rows captured at or after cutoffMs from the local trace.db copy. */
function queryVoiceMemos(dbDir, cutoffMs) {
  const dbPath = join(dbDir, "trace.db");
  const sql = `select id, capturedAt, state, transcript from voice_memo where capturedAt >= ${cutoffMs} order by capturedAt asc;`;
  const out = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : [];
}

/** Renders voice-memo rows as the markdown body of a tangent note. */
function formatNote(rows) {
  const lines = [`## Voice memos, last 24h (${rows.length})`, ""];
  for (const r of rows) {
    const ts = new Date(r.capturedAt).toISOString();
    lines.push(`### ${ts} — ${r.state}`);
    lines.push(r.transcript ? r.transcript.trim() : "(no transcript yet)");
    lines.push("");
  }
  return lines.join("\n");
}

/** Creates the voice-memos node overview if missing and links it from otto/overview.md (no orphans). */
function ensureLinkedFromOverview() {
  const parentOverview = join(VAULT, "otto", "overview.md");
  const link = "[[otto/voice-memos/overview]]";
  let content = readFileSync(parentOverview, "utf8");
  if (content.includes(link)) return;
  content = content.trimEnd() + `\n- ${link}: Trace voice-memo transcripts pulled from the phone via adb.\n`;
  writeFileSync(parentOverview, content);

  const nodeOverview = join(NODE_DIR, "overview.md");
  if (!existsSync(nodeOverview)) {
    writeFileSync(
      nodeOverview,
      "# Voice memos\n\nTrace voice-memo transcripts pulled off the phone via `otto-tangent/scripts/pull-trace-voice-memos.mjs`. Otto Launcher transcribes these on-device with Groq; this just reads the result out of trace.db.\n"
    );
  }
}

/** Formats a Date as the YYYY-MM-DD slug used in note filenames. */
function dateSlug(d) {
  return d.toISOString().slice(0, 10);
}

/** Writes the voice-memo rows to a new dated note in the vault, appending -HHMM if today's note exists. */
function writeNote(rows) {
  mkdirSync(NODE_DIR, { recursive: true });
  ensureLinkedFromOverview();

  const now = new Date();
  const slug = `${dateSlug(now)}-voice-memos.md`;
  let notePath = join(NODE_DIR, slug);
  if (existsSync(notePath)) {
    const hhmm = now.toISOString().slice(11, 16).replace(":", "");
    notePath = join(NODE_DIR, `${dateSlug(now)}-voice-memos-${hhmm}.md`);
  }

  const frontmatter = `---\nat: ${now.toISOString()}\nsource: trace.db voice_memo (on-device Groq transcription)\n---\n\n`;
  writeFileSync(notePath, frontmatter + formatNote(rows));
  return notePath;
}

/** Stages and commits the new note in the vault repo. */
function commit(notePath) {
  const rel = notePath.replace(VAULT + "/", "");
  execFileSync("git", ["-C", VAULT, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", VAULT, "commit", "-m", `note: otto/voice-memos ${rel}`], { stdio: "pipe" });
}

/** Entry point: validates the phone is connected, pulls trace.db, and files/commits the note. */
function main() {
  const adb = findAdb();
  if (!adb) {
    console.error("adb not found. Install Android platform-tools or set ANDROID_HOME/ANDROID_SDK_ROOT.");
    process.exit(1);
  }

  let device;
  try {
    device = getConnectedDevice(adb);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!device) {
    console.error("No phone connected via adb. Plug it in via USB, enable USB debugging, and retry.");
    process.exit(1);
  }

  let dbDir;
  try {
    dbDir = pullTraceDb(adb);
    const cutoff = Date.now() - WINDOW_MS;
    const rows = queryVoiceMemos(dbDir, cutoff);

    if (rows.length === 0) {
      console.log("No voice memos in the last 24h.");
      return;
    }

    const notePath = writeNote(rows);
    commit(notePath);
    console.log(`noted -> ${notePath.replace(HOME, "~")}`);
  } finally {
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  }
}

main();
