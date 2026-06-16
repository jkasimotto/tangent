import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTreesClient, type TreesClient, type TreesClientOptions, type TreeEventQuery, type TreeEventStore } from "@tangent/trees-core";
import { isTreeEvent, type TreeEvent } from "@tangent/trees-schema";

export type FsTreeStoreOptions = {
  root?: string;
};

export type FsTreesClientOptions = FsTreeStoreOptions & TreesClientOptions;

/** Documents the defaultTreesHome helper. */
export function defaultTreesHome(): string {
  return path.join(os.homedir(), ".tangent", "trees");
}

/** Documents the createFsTreeEventStore helper. */
export function createFsTreeEventStore(options: FsTreeStoreOptions = {}): TreeEventStore {
  const root = options.root || defaultTreesHome();
  return {
    /** Documents the append helper. */
    async append(event) {
      const file = eventLogFile(root, event.at);
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
      return event;
    },
    /** Documents the query helper. */
    async query(query = {}) {
      const files = await eventFiles(path.join(root, "events"));
      const events: TreeEvent[] = [];
      for (const file of files) events.push(...await readEventFile(file));
      return events
        .filter((event) => matchesQuery(event, query))
        .sort((a, b) => a.at.localeCompare(b.at));
    }
  };
}

/** Documents the openFsTrees helper. */
export async function openFsTrees(options: FsTreesClientOptions = {}): Promise<TreesClient> {
  const root = options.root || defaultTreesHome();
  await mkdir(path.join(root, "events"), { recursive: true });
  await mkdir(path.join(root, "snapshots"), { recursive: true });
  await mkdir(path.join(root, "imports"), { recursive: true });
  return createTreesClient(createFsTreeEventStore({ root }), options);
}

/** Documents the writeProjectionSnapshot helper. */
export async function writeProjectionSnapshot(root: string, name: string, value: unknown): Promise<string> {
  const snapshots = path.join(root, "snapshots");
  await mkdir(snapshots, { recursive: true });
  const target = path.join(snapshots, `${name}.json`);
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return target;
}

/** Documents the readProjectionSnapshot helper. */
export async function readProjectionSnapshot<T>(root: string, name: string): Promise<T | undefined> {
  const target = path.join(root, "snapshots", `${name}.json`);
  return readFile(target, "utf8").then((text) => JSON.parse(text) as T).catch(() => undefined);
}

/** Documents the eventLogFile helper. */
function eventLogFile(root: string, at: string): string {
  const [date] = at.split("T");
  const [year, month] = date!.split("-");
  return path.join(root, "events", year!, month!, `trees-${date}.jsonl`);
}

/** Documents the eventFiles helper. */
async function eventFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await eventFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
  }
  return files.sort();
}

/** Documents the readEventFile helper. */
async function readEventFile(file: string): Promise<TreeEvent[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  const events: TreeEvent[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isTreeEvent(parsed)) events.push(parsed);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: invalid Trees event JSON: ${(error as Error).message}`);
    }
  }
  return events;
}

/** Documents the matchesQuery helper. */
function matchesQuery(event: TreeEvent, query: TreeEventQuery): boolean {
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type];
    if (!types.includes(event.type)) return false;
  }
  if (query.entityId && event.entityId !== query.entityId) return false;
  if (query.workSessionId && event.workSessionId !== query.workSessionId) return false;
  if (query.agentRunId && event.agentRunId !== query.agentRunId) return false;
  if (query.terminalSessionId && event.terminalSessionId !== query.terminalSessionId) return false;
  if (query.attentionItemId && event.attentionItemId !== query.attentionItemId) return false;
  if (query.captureId && event.captureId !== query.captureId) return false;
  if (query.checkpointId && event.checkpointId !== query.checkpointId) return false;
  if (query.since && event.at < query.since) return false;
  if (query.until && event.at > query.until) return false;
  return true;
}
