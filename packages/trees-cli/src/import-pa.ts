import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parentPathFor, titleFromPath, validateEntityPath, type Capture, type Checkpoint, type TreeEntity, type TreeEvent, type TreeObservation, type WorkSession } from "@tangent/trees-schema";
import type { TreesClient } from "@tangent/trees-core";

export type ImportPaOptions = {
  from?: string;
  dryRun?: boolean;
};

export type ImportPaReport = {
  source: string;
  dryRun: boolean;
  entities: number;
  workSessions: number;
  checkpoints: number;
  captures: number;
  legacyObservations: number;
  warnings: string[];
};

/** Documents the importPa helper. */
export async function importPa(client: TreesClient, options: ImportPaOptions = {}): Promise<ImportPaReport> {
  const sourceRoot = expandHome(options.from || "~/.wt");
  const report: ImportPaReport = { source: sourceRoot, dryRun: Boolean(options.dryRun), entities: 0, workSessions: 0, checkpoints: 0, captures: 0, legacyObservations: 0, warnings: [] };
  const files = await walkFiles(sourceRoot);
  const existing = await client.projection();
  const entityByPath = new Map(existing.entities.map((entity) => [entity.path, entity]));

  for (const file of files.filter((candidate) => candidate.endsWith("entity.conf"))) {
    const rel = path.relative(path.join(sourceRoot, "entities"), path.dirname(file)).split(path.sep).join("/");
    const entityPath = safeEntityPath(rel, report);
    if (!entityPath) continue;
    const conf = parseConf(await readFile(file, "utf8"));
    const entity = importedEntity(entityPath, conf, file);
    if (!options.dryRun) {
      const current = entityByPath.get(entity.path);
      if (current) await client.events.append(importEvent("entity.updated", file, { patch: { ...entity, id: current.id, createdAt: current.createdAt } }, { entityId: current.id }));
      else await client.events.append(importEvent("entity.created", file, { entity }, { entityId: entity.id }));
    }
    entityByPath.set(entity.path, entity);
    report.entities += 1;
  }

  await importCurrentPulse(client, sourceRoot, entityByPath, report, options);
  await importCompletedPulses(client, sourceRoot, entityByPath, report, options);
  await importInbox(client, sourceRoot, entityByPath, report, options);
  await importLegacySessionSidecars(client, files, entityByPath, report, options);
  return report;
}

/** Documents the importCurrentPulse helper. */
async function importCurrentPulse(client: TreesClient, sourceRoot: string, entities: Map<string, TreeEntity>, report: ImportPaReport, options: ImportPaOptions): Promise<void> {
  const file = path.join(sourceRoot, "current_pulse.conf");
  const text = await readFile(file, "utf8").catch(() => "");
  if (!text.trim()) return;
  const conf = parseConf(text);
  const entity = resolveImportedEntity(entities, conf.entity || conf.path);
  if (!entity) {
    report.warnings.push(`current_pulse.conf skipped: missing entity`);
    return;
  }
  const at = conf.created || conf.started || new Date().toISOString();
  const workSession = importedSession(entity, file, at, "active", {
    intent: conf.intent,
    doneWhen: conf.done_when || conf.doneWhen,
    estimateText: conf.estimate
  });
  if (!options.dryRun) await client.events.append(importEvent("workSession.started", file, { workSession }, { entityId: entity.id, workSessionId: workSession.id }));
  report.workSessions += 1;
}

/** Documents the importCompletedPulses helper. */
async function importCompletedPulses(client: TreesClient, sourceRoot: string, entities: Map<string, TreeEntity>, report: ImportPaReport, options: ImportPaOptions): Promise<void> {
  const file = path.join(sourceRoot, "pulses.jsonl");
  const text = await readFile(file, "utf8").catch(() => "");
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const raw = parseJsonLine(line, file, index + 1, report);
    if (!raw) continue;
    const entity = resolveImportedEntity(entities, stringField(raw, "entity") || stringField(raw, "path"));
    if (!entity) {
      report.warnings.push(`${file}:${index + 1}: skipped pulse without importable entity`);
      continue;
    }
    const at = stringField(raw, "created") || stringField(raw, "ended") || new Date().toISOString();
    const workSession = importedSession(entity, `${file}:${index + 1}`, at, "done", { intent: stringField(raw, "intent"), doneWhen: stringField(raw, "doneWhen") || stringField(raw, "done_when"), estimateText: stringField(raw, "estimate") });
    const checkpoint = importedCheckpoint(workSession, entity, `${file}:${index + 1}`, at, raw);
    if (!options.dryRun) {
      await client.events.append(importEvent("workSession.started", `${file}:${index + 1}`, { workSession }, { entityId: entity.id, workSessionId: workSession.id }));
      await client.events.append(importEvent("workSession.checkpointed", `${file}:${index + 1}`, { checkpoint }, { entityId: entity.id, workSessionId: workSession.id, checkpointId: checkpoint.id }));
    }
    report.workSessions += 1;
    report.checkpoints += 1;
  }
}

/** Documents the importInbox helper. */
async function importInbox(client: TreesClient, sourceRoot: string, entities: Map<string, TreeEntity>, report: ImportPaReport, options: ImportPaOptions): Promise<void> {
  const inbox = path.join(sourceRoot, "inbox");
  const files = (await walkFiles(inbox)).filter((file) => file.endsWith(".conf") || file.endsWith(".md"));
  const grouped = new Map<string, { conf?: string; md?: string }>();
  for (const file of files) {
    const key = file.replace(/\.(conf|md)$/, "");
    grouped.set(key, { ...grouped.get(key), [file.endsWith(".conf") ? "conf" : "md"]: file });
  }
  for (const [key, pair] of grouped) {
    const conf = pair.conf ? parseConf(await readFile(pair.conf, "utf8")) : {};
    const text = pair.md ? await readFile(pair.md, "utf8") : conf.text || conf.raw || "";
    if (!text.trim()) continue;
    const entity = resolveImportedEntity(entities, conf.entity || conf.path);
    const capture: Capture = {
      schema: "tangent.trees.capture.v1",
      id: `cap_pa_${hash(key)}`,
      entityId: entity?.id,
      kind: captureKind(conf.kind),
      text,
      status: conf.resolved === "true" ? "resolved" : "open",
      source: importSource(pair.conf || pair.md || key),
      createdBy: { id: conf.creator || conf.createdBy || "pa-import", kind: "import" },
      createdAt: conf.created || new Date().toISOString(),
      evidence: [fileEvidence(pair.conf || pair.md || key)]
    };
    if (!options.dryRun) await client.events.append(importEvent("capture.created", pair.conf || pair.md || key, { capture }, { entityId: entity?.id, captureId: capture.id }));
    report.captures += 1;
  }
}

/** Documents the importLegacySessionSidecars helper. */
async function importLegacySessionSidecars(client: TreesClient, files: string[], entities: Map<string, TreeEntity>, report: ImportPaReport, options: ImportPaOptions): Promise<void> {
  for (const file of files.filter((candidate) => /\.(state|tokens|label)$/.test(candidate))) {
    const text = await readFile(file, "utf8").catch(() => "");
    const label = path.basename(file).replace(/\.(state|tokens|label)$/, "");
    const entity = resolveImportedEntity(entities, label);
    const observation: TreeObservation = {
      schema: "tangent.trees.observation.v1",
      id: `obs_pa_${hash(file)}`,
      observedAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      source: importSource(file),
      subject: { entityId: entity?.id },
      kind: "agent.status",
      data: { legacyKind: path.extname(file).slice(1), raw: text },
      confidence: "imported",
      evidence: [fileEvidence(file)]
    };
    if (!options.dryRun) await client.events.append(importEvent("observation.recorded", file, { observation }, { entityId: entity?.id }));
    report.legacyObservations += 1;
  }
}

/** Documents the importedEntity helper. */
function importedEntity(entityPath: string, conf: Record<string, string>, file: string): TreeEntity {
  const now = conf.created || new Date().toISOString();
  return {
    schema: "tangent.trees.entity.v1",
    id: `ent_pa_${hash(entityPath)}`,
    path: entityPath,
    parentPath: parentPathFor(entityPath),
    title: conf.title || titleFromPath(entityPath),
    kind: conf.worktree || conf.branch ? "work" : "group",
    projectId: conf.project,
    repoRoot: conf.repoRoot || conf.repo_root,
    worktreePath: conf.worktree,
    branch: conf.branch,
    agentDefaults: conf.agent ? { adapterId: conf.agent } : undefined,
    description: conf.note,
    tags: splitList(conf.tags),
    createdAt: now,
    updatedAt: conf.updated || now,
    providerFields: { importedFrom: file }
  };
}

/** Documents the importedSession helper. */
function importedSession(entity: TreeEntity, file: string, at: string, status: WorkSession["status"], input: { intent?: string; doneWhen?: string; estimateText?: string }): WorkSession {
  return {
    schema: "tangent.trees.workSession.v1",
    id: `ws_pa_${hash(`${file}:${entity.path}`)}`,
    entityId: entity.id,
    entityPath: entity.path,
    status,
    intent: input.intent,
    doneWhen: input.doneWhen,
    estimate: input.estimateText ? { text: input.estimateText, source: "unknown" } : undefined,
    startedAt: at,
    endedAt: status === "active" ? undefined : at,
    startedBy: { id: "pa-import", kind: "import" },
    endedBy: status === "active" ? undefined : { id: "pa-import", kind: "import" },
    agentRunIds: [],
    terminalSessionIds: [],
    usageSessionIds: [],
    checkpointIds: [],
    captureIds: [],
    createdAt: at,
    updatedAt: at,
    evidence: [fileEvidence(file)]
  };
}

/** Documents the importedCheckpoint helper. */
function importedCheckpoint(session: WorkSession, entity: TreeEntity, file: string, at: string, raw: Record<string, unknown>): Checkpoint {
  return {
    schema: "tangent.trees.checkpoint.v1",
    id: `chk_pa_${hash(file)}`,
    workSessionId: session.id,
    entityId: entity.id,
    kind: stringField(raw, "blocker") ? "blocked" : "done",
    outcome: stringField(raw, "blocker") ? "blocked" : "done",
    actual: stringField(raw, "actual") ? { text: stringField(raw, "actual") } : undefined,
    did: stringField(raw, "did"),
    learned: stringField(raw, "learned"),
    evidenceText: stringField(raw, "evidence"),
    next: stringField(raw, "next"),
    blocker: stringField(raw, "blocker"),
    raw: JSON.stringify(raw),
    linkedCaptureIds: splitList(stringField(raw, "captureIds") || stringField(raw, "capture_ids")),
    linkedAttentionItemIds: [],
    createdAt: at,
    createdBy: { id: stringField(raw, "actor") || "pa-import", kind: "import" },
    source: importSource(file),
    evidence: [fileEvidence(file)]
  };
}

/** Documents the importEvent helper. */
function importEvent(type: string, file: string, data: Record<string, unknown>, ids: Partial<Pick<TreeEvent, "entityId" | "workSessionId" | "captureId" | "checkpointId">> = {}): TreeEvent {
  return {
    schema: "tangent.trees.event.v1",
    id: `evt_pa_${hash(`${type}:${file}:${JSON.stringify(data).slice(0, 200)}`)}`,
    type,
    at: new Date().toISOString(),
    actor: { id: "pa-import", kind: "import" },
    source: importSource(file),
    data,
    evidence: [fileEvidence(file)],
    ...ids
  };
}

/** Documents the parseConf helper. */
function parseConf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:=|:)\s*"?([^"]*)"?$/);
    if (match) out[camel(match[1]!)] = match[2]!.trim();
  }
  return out;
}

/** Documents the parseJsonLine helper. */
function parseJsonLine(line: string, file: string, lineNo: number, report: ImportPaReport): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch (error) {
    report.warnings.push(`${file}:${lineNo}: invalid JSON: ${(error as Error).message}`);
    return undefined;
  }
}

/** Documents the safeEntityPath helper. */
function safeEntityPath(value: string, report: ImportPaReport): string | undefined {
  try {
    return validateEntityPath(value || "root");
  } catch (error) {
    report.warnings.push(`invalid entity path ${value}: ${(error as Error).message}`);
    return undefined;
  }
}

/** Documents the resolveImportedEntity helper. */
function resolveImportedEntity(entities: Map<string, TreeEntity>, ref: string | undefined): TreeEntity | undefined {
  if (!ref) return undefined;
  return entities.get(ref) || [...entities.values()].find((entity) => entity.id === ref || entity.path.endsWith(`/${ref}`));
}

/** Documents the fileEvidence helper. */
function fileEvidence(file: string) {
  return { id: `evidence_pa_${hash(file)}`, kind: "import" as const, path: file, rawHash: hashFilePath(file) };
}

/** Documents the importSource helper. */
function importSource(file: string) {
  return { id: `pa:${hash(file)}`, kind: "import" as const, sourcePath: file, rawHash: hashFilePath(file) };
}

/** Documents the walkFiles helper. */
async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

/** Documents the stringField helper. */
function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Documents the captureKind helper. */
function captureKind(value: string | undefined): Capture["kind"] {
  const allowed: Capture["kind"][] = ["note", "thought", "finding", "question", "evidence", "next", "risk", "blocker", "decision", "raw"];
  return allowed.includes(value as Capture["kind"]) ? value as Capture["kind"] : "note";
}

/** Documents the splitList helper. */
function splitList(value: string | undefined): string[] {
  return value ? value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean) : [];
}

/** Documents the camel helper. */
function camel(value: string): string {
  return value.replace(/[-_]([a-z])/g, (_, char: string) => char.toUpperCase());
}

/** Documents the expandHome helper. */
function expandHome(value: string): string {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

/** Documents the hash helper. */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Documents the hashFilePath helper. */
function hashFilePath(file: string): string {
  return hash(file);
}
