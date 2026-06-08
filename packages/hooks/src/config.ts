import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isRecord } from "@tangent/core";
import { pathExists } from "@tangent/repo";
import type { HookCommandOptions, HookProvider } from "./types.js";

export const defaultRecordCommand = "tangent hooks record";

export function hookCommand(options: HookCommandOptions): string {
  const recordCommand = options.recordCommand || defaultRecordCommand;
  return [
    recordCommand,
    `--provider ${options.provider}`,
    `--scope ${options.scope}`,
    options.repoRoot ? `--repo-root ${shellQuote(options.repoRoot)}` : undefined
  ].filter(Boolean).join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function mergeJsonConfig(filePath: string, managedConfig: Record<string, unknown>, provider: HookProvider, managedCommandFragments = managedHookCommandFragments()): Promise<void> {
  const existing = await readJsonObject(filePath);
  const cleaned = removeManagedFromObject(existing, provider, managedCommandFragments);
  const merged = mergeHooks(cleaned, managedConfig);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

export async function removeManagedHooks(filePath: string, provider: HookProvider, managedCommandFragments = managedHookCommandFragments()): Promise<void> {
  const existing = await readJsonObject(filePath);
  const cleaned = removeManagedFromObject(existing, provider, managedCommandFragments);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
}

export async function hasManagedHookCommand(filePath: string, provider: HookProvider, scope: string, managedCommandFragments = managedHookCommandFragments()): Promise<boolean> {
  if (!(await pathExists(filePath))) return false;
  try {
    const text = await readFile(filePath, "utf8");
    const config = JSON.parse(text) as unknown;
    const commands = collectHookCommands(config);
    const expectedProvider = `--provider ${provider}`;
    const expectedScope = `--scope ${scope}`;
    return commands.some((command) => {
      const isManaged = managedCommandFragments.some((fragment) => command.includes(fragment));
      return isManaged && command.includes(expectedProvider) && command.includes(expectedScope);
    });
  } catch {
    return false;
  }
}

export function collectHookCommands(value: unknown): string[] {
  const commands: string[] = [];
  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.command === "string") commands.push(node.command);
    for (const child of Object.values(node)) visit(child);
  }
  visit(value);
  return commands;
}

export function managedHookCommandFragments(recordCommand = defaultRecordCommand): string[] {
  return [
    recordCommand,
    "tangent usage hook record",
    "usage hook record",
    "pagent usage hook record"
  ];
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(filePath))) return {};
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function mergeHooks(existing: Record<string, unknown>, managedConfig: Record<string, unknown>): Record<string, unknown> {
  const next = { ...existing };
  const existingHooks = objectValue(next.hooks);
  const managedHooks = objectValue(managedConfig.hooks);
  next.hooks = { ...existingHooks };
  for (const [event, groups] of Object.entries(managedHooks)) {
    const currentGroups = Array.isArray((next.hooks as Record<string, unknown>)[event])
      ? (next.hooks as Record<string, unknown>)[event] as unknown[]
      : [];
    (next.hooks as Record<string, unknown>)[event] = [...currentGroups, ...(Array.isArray(groups) ? groups : [])];
  }
  return next;
}

function removeManagedFromObject(config: Record<string, unknown>, provider: HookProvider | undefined, managedCommandFragments: string[]): Record<string, unknown> {
  const next = { ...config };
  const hooks = objectValue(next.hooks);
  next.hooks = Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => [
      event,
      Array.isArray(groups)
        ? groups.map(removeManagedFromGroup).filter(groupHasHooks)
        : groups
    ]).filter(([, groups]) => !Array.isArray(groups) || groups.length > 0)
  );
  return next;

  function removeManagedFromGroup(group: unknown): unknown {
    if (!isRecord(group)) return group;
    const record = { ...group };
    const hooksArray = Array.isArray(record.hooks) ? record.hooks : [];
    record.hooks = hooksArray.filter((hook) => !isManagedHook(hook, provider, managedCommandFragments));
    return record;
  }
}

function groupHasHooks(group: unknown): boolean {
  return Boolean(isRecord(group) && Array.isArray(group.hooks) && group.hooks.length > 0);
}

function isManagedHook(hook: unknown, provider: HookProvider | undefined, managedCommandFragments: string[]): boolean {
  if (!isRecord(hook) || typeof hook.command !== "string") return false;
  const command = hook.command;
  const isManaged = managedCommandFragments.some((fragment) => command.includes(fragment));
  return isManaged && (provider ? command.includes(`--provider ${provider}`) : true);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
