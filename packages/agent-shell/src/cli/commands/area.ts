import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { currentTmuxSession, listAreaNodes, postJson, requireArea, resolveServerUrl, vaultFetch } from "../client.js";
import { areaCommandSpec } from "../spec.js";

/** Dispatches `tangent area` subcommands. */
export async function runAreaCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, {
    boolean: ["json", "all", "allow-missing", "clear-label", "confirm-last-known", ...(argv[0] === "propose" ? [] : ["withdraw"])],
    repeatable: ["candidate"],
  });
  const subcommand = args._[0];
  if (subcommand === "resource") {
    try { return await resourceCommand(args); }
    catch (error) {
      if (!booleanArg(args.json)) throw error;
      printJson(resourceFailureEnvelope(error, args));
      process.exitCode = 1;
      return;
    }
  }
  if (!subcommand || args.help) return help();
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "recent") return recentCommand(args);
  if (subcommand === "audit") return auditCommand(args);
  if (subcommand === "create") return createCommand(args);
  if (subcommand === "present") return presentCommand(args);
  if (subcommand === "picture") return pictureCommand(args);
  if (subcommand === "propose") return proposeCommand(args);
  if (subcommand === "promote") return promoteCommand(args);
  if (subcommand === "done") return statusCommand(args, "done");
  if (subcommand === "archive") return statusCommand(args, "archived");
  if (subcommand === "reopen") return statusCommand(args, "active");
  throw new Error(`Unknown area command: ${subcommand}. Try "tangent area list", "tangent area show <area>", "tangent area resource --help", "tangent area create <parent> <name>", "tangent area done <area>", "tangent area archive <area>", or "tangent area reopen <area>".`);
}

/** Presents or withdraws the exact Area brain's structured big picture. */
async function pictureCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area picture requires <area>."));
  const session = stringArg(args.session) || (await currentTmuxSession()) || "";
  if (booleanArg(args.withdraw)) {
    await postJson(server, "/api/areas/picture/withdraw", { area, session, hash: stringArg(args.hash) });
    console.log(`withdrew the picture for ${area}`);
    return;
  }
  const file = requiredString(args.file, "tangent area picture requires --file <json>." );
  const picture = JSON.parse(await readFile(file, "utf8"));
  const result = await postJson(server, "/api/areas/picture", { area, session, picture: { ...picture, area } });
  console.log(`${result.idempotent ? "kept" : "presented"} picture ${result.picture.version} for ${area}`);
}

/** Creates, updates, or withdraws a brain-owned block proposal. */
async function proposeCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area propose requires <area>."));
  const session = stringArg(args.session) || (await currentTmuxSession()) || "";
  const withdraw = stringArg(args.withdraw);
  if (withdraw) {
    const result = await postJson(server, "/api/areas/map-proposals/withdraw", { area, session, id: withdraw, version: Number(requiredString(args.version, "proposal withdrawal requires --version <number>.")) });
    console.log(`withdrew proposal ${result.proposal.id}`);
    return;
  }
  const source = stringArg(args.source); const link = stringArg(args.link);
  if (Boolean(source) === Boolean(link)) throw new Error("tangent area propose needs exactly one of --source or --link.");
  const split = source?.indexOf("#") ?? -1;
  const proposal = source
    ? { kind: "file", source: { file: split < 0 ? source : source.slice(0, split), ...(split < 0 ? {} : { subpath: source.slice(split) }) }, note: stringArg(args.note) ?? "" }
    : { kind: "link", source: { kind: "link", url: link }, note: stringArg(args.note) ?? "" };
  const result = await postJson(server, "/api/areas/map-proposals", { area, session, proposal });
  console.log(`${result.idempotent ? "kept" : "proposed"} ${result.proposal.id}`);
}

/** Attaches the durable result that the exact Area brain created for an ink promotion. */
async function promoteCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area promote requires <area>."));
  const id = requiredString(args.complete, "tangent area promote requires --complete <operation-id>." );
  const source = requiredString(args.source, "promotion completion requires --source <vault-file[#subpath]>." );
  const split = source.indexOf("#");
  const durableRef = { file: split < 0 ? source : source.slice(0, split), ...(split < 0 ? {} : { subpath: source.slice(split) }) };
  const result = await postJson(server, "/api/areas/map-promotions/complete", { area, id, durableRef, brainNoticeId: stringArg(args.notice), session: stringArg(args.session) || (await currentTmuxSession()) || "" });
  console.log(`${result.idempotent ? "kept" : "attached"} durable result for ${result.promotion.id}`);
}

/** Presents or withdraws a Document in an Area without creating a Goal relation. */
async function presentCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area present requires <area> <file>..."));
  const files = args._.slice(2).map(String).filter(Boolean);
  if (!files.length) throw new Error("tangent area present requires at least one <file>.");
  const session = stringArg(args.session) || (await currentTmuxSession()) || "";
  if (booleanArg(args.withdraw)) {
    if (files.length !== 1) throw new Error("tangent area present --withdraw takes one <file>.");
    await postJson(server, "/api/areas/withdraw-presentation", { area, file: files[0], session });
    console.log(`withdrew ${files[0]} from ${area}`);
    return;
  }
  const result = await postJson(server, "/api/areas/present", { area, files, note: stringArg(args.note) ?? "", session });
  console.log(`presented ${result.items.length} document${result.items.length === 1 ? "" : "s"} on ${area}`);
}

/** Exports legacy coordination records to a detached compressed audit file. */
async function auditCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area audit requires <area>."));
  const result = await postJson(server, "/api/areas/legacy-audit", { area });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`legacy audit: ${result.output}`);
  for (const source of result.manifest) console.log(`  ${source.name}: ${source.records} records  sha256:${source.hash}`);
}

/** Handles `tangent area recent <area>` with subtree context by default. */
async function recentCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area recent requires <area>."));
  const query = new URLSearchParams({ area, limit: stringArg(args.limit) || "12" });
  if (stringArg(args.since)) query.set("since", stringArg(args.since) || "");
  if (stringArg(args.query)) query.set("query", stringArg(args.query) || "");
  const result = await vaultFetch(server, `/api/areas/milestones?${query}`);
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  if (!result.milestones.length) console.log(`No material milestones in ${area} or its child Areas${stringArg(args.query) || stringArg(args.since) ? " match these filters" : ""}.`);
  for (const item of result.milestones) console.log(`${item.createdAt}  ${item.area}  ${item.kind}  ${item.summary}`);
  if (result.omitted) console.log(`${result.omitted} more. Increase --limit, or narrow with --since and --query.`);
}

/**
 * Handles `tangent area list`. Done and archived Areas, and every Area
 * inside one, are folded away unless `--all` asks for them, then they print
 * with their status.
 */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const all = booleanArg(args.all);
  const nodes = (await listAreaNodes(server)).sort((a, b) => a.path.localeCompare(b.path));
  const hidden = new Set(nodes.filter((node) => HIDDEN_AREA_STATUSES.has(node.status)).map((node) => node.path));
  /** True when the Area or one of its ancestors is done or archived. */
  const folded = (path: string) => path.split("/").some((_part, index, parts) => hidden.has(parts.slice(0, index + 1).join("/")));
  const shown = all ? nodes : nodes.filter((node) => !folded(node.path));
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(all ? shown.map((node) => ({ path: node.path, status: node.status })) : shown.map((node) => node.path), null, 2));
    return;
  }
  if (!shown.length) {
    console.log(nodes.length ? "Every Area is done or archived. Use --all to list them." : "No Areas yet.");
    return;
  }
  /** The status label of a folded Area: its own hidden status, or the hidden ancestor's. */
  const foldedLabel = (path: string) => hidden.has(path) ? nodes.find((node) => node.path === path)?.status : `under ${nodes.find((node) => hidden.has(node.path) && path.startsWith(`${node.path}/`))?.status}`;
  for (const node of shown) console.log(all && folded(node.path) ? `${node.path}  [${foldedLabel(node.path)}]` : node.path);
  const foldedCount = nodes.length - shown.length;
  if (foldedCount) console.log(`${foldedCount} done or archived ${foldedCount === 1 ? "Area is" : "Areas are"} not listed. Use --all.`);
}

/** The Area statuses that fold an Area away from lists (area-archive Decision 3). */
const HIDDEN_AREA_STATUSES = new Set(["done", "archived"]);

type MapResourceLocator = { owner: string; id: string };
type MapResourceTarget =
  | { kind: "worktree" | "repository"; path: string }
  | { kind: "link"; url: string }
  | { kind: "local-path"; path: string };
type MapResourceEntity = {
  locator?: MapResourceLocator;
  label?: string;
  target?: MapResourceTarget;
  representation?: string | { state?: string; value?: string };
  local?: { state?: string; value?: { state?: string } | null } | null;
  link?: { kind?: string; lifecycle?: { state?: string; value?: { stateLabel?: string } | null } } | null;
  reason?: string;
  lastKnown?: { label?: string; target?: MapResourceTarget } | null;
};
type MapResourceRow = {
  viewedFrom?: string;
  relation?: { kind?: "direct" | "inherited"; sourceArea?: string };
  entity?: MapResourceEntity;
};
type CatalogRevision = { owner: string; revision: string | null };
type ResourceSuggestion = {
  owner?: string;
  target?: MapResourceTarget;
  evidence?: Record<string, unknown>;
  evidenceHash?: string;
  targetFingerprint?: string;
  proposedLabel?: string | null;
  provenanceLabel?: string;
};
type LegacyResourceCandidate = ResourceSuggestion & {
  state?: "candidate" | "invalid";
  field?: string;
  declaredBranch?: string | null;
  message?: string;
};
type MapResourceProjection = {
  state?: "current" | "partial" | "unavailable";
  rows?: MapResourceRow[];
  catalogs?: CatalogRevision[];
  legacyReview?: LegacyResourceCandidate[];
  suggestions?: ResourceSuggestion[];
  problems?: Array<{ kind?: string; error?: { message?: string }; message?: string }>;
  error?: { message?: string };
};
type MapSourceElement = {
  id?: string;
  isDeleted?: boolean;
  containerId?: string | null;
  customData?: { tangent?: { kind?: string; ref?: string } };
};
type MapSourceShard = {
  owner?: string;
  state?: string;
  hash?: string | null;
  scene?: { elements?: MapSourceElement[] };
};

const RESOURCE_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const RESOURCE_KINDS = new Set(["worktree", "repository", "link"]);

/** Returns one stable machine-readable failure without exposing arbitrary exception fields. */
function resourceFailureEnvelope(error: unknown, args: Args): Record<string, unknown> {
  const typed = error && typeof error === "object" ? error as Error & {
    status?: unknown;
    code?: unknown;
    operationId?: unknown;
    payload?: unknown;
  } : null;
  const payload = typed?.payload && typeof typed.payload === "object" && !Array.isArray(typed.payload)
    ? typed.payload as Record<string, unknown>
    : null;
  const status = Number(payload?.status ?? typed?.status);
  const suppliedCode = String(payload?.code ?? typed?.code ?? "").trim();
  const code = suppliedCode || "area-resource-command-failed";
  const message = String(payload?.error ?? typed?.message ?? error ?? "The Area resource command failed.");
  const requestedOperationId = stringArg(args["operation-id"])?.trim();
  const suppliedOperationId = String(payload?.operationId ?? typed?.operationId ?? requestedOperationId ?? "").trim();
  const operationId = RESOURCE_OPERATION_ID.test(suppliedOperationId) ? suppliedOperationId : "";
  return {
    ...(Number.isInteger(status) && status > 0 ? { status } : {}),
    code,
    error: message,
    retryable: payload?.retryable === true,
    ...(operationId ? { operationId } : {}),
    ...(payload?.recovery && typeof payload.recovery === "object" && !Array.isArray(payload.recovery) ? { recovery: payload.recovery } : {}),
  };
}

/** Dispatches the Brain-facing `tangent area resource` inventory and mutation commands. */
async function resourceCommand(args: Args): Promise<void> {
  const command = String(args._[1] ?? "");
  if (!command || args.help) return resourceHelp(command);
  if (command === "list") return resourceListCommand(args);
  if (command === "show") return resourceShowCommand(args);
  if (command === "add") return resourceAddCommand(args);
  if (command === "associate") return resourceAssociateCommand(args);
  if (command === "import") return resourceImportCommand(args);
  if (command === "discover") return resourceDiscoverCommand(args);
  if (command === "dismiss") return resourceDismissCommand(args);
  if (["place", "hide", "restore"].includes(command)) return resourceRepresentationCommand(args, command as "place" | "hide" | "restore");
  if (command === "add-back") return resourceAddBackCommand(args);
  if (command === "edit") return resourceEditCommand(args);
  if (command === "remove") return resourceRemoveCommand(args);
  if (command === "check" || command === "refresh") return resourceRefreshCommand(args);
  if (command === "undo") return resourceUndoCommand(args);
  throw new Error(`Unknown area resource command: ${command}. Run "tangent area resource --help" for available commands.`);
}

/** Resolves one required Area and its loopback server for a nested resource command. */
async function resourceArea(args: Args, command: string): Promise<{ server: URL; area: string }> {
  const server = resolveServerUrl(stringArg(args.server));
  const requested = requiredString(args._[2], `tangent area resource ${command} requires <area>.`);
  return { server, area: await requireArea(server, requested) };
}

/** Reads one Area's current catalog projection without starting discovery or observation work. */
async function readResourceProjection(server: URL, area: string): Promise<MapResourceProjection> {
  return await vaultFetch(server, `/api/areas/map-resources?area=${encodeURIComponent(area)}`) as MapResourceProjection;
}

/** Refuses a mutation against partial or unavailable catalog authority. */
function writableResourceProjection(projection: MapResourceProjection): MapResourceProjection {
  if (projection.state === "current") return projection;
  const problem = projection.error?.message ?? projection.problems?.map((item) => item.error?.message ?? item.message).filter(Boolean).join("; ");
  throw new Error(`Map resources are ${projection.state ?? "unavailable"}${problem ? `: ${problem}` : ""}. Reload them before changing anything.`);
}

/** Prints one machine-readable value without changing the server's response shape. */
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

/** Returns the exact action target stored by one current or gone resource. */
function resourceTarget(entity: MapResourceEntity | undefined): MapResourceTarget | null {
  return entity?.target ?? entity?.lastKnown?.target ?? null;
}

/** Returns the exact path or URL text of one resource target. */
function resourceTargetText(target: MapResourceTarget | null | undefined): string {
  return target && "path" in target ? target.path : target && "url" in target ? target.url : "(target unavailable)";
}

/** Returns one resource's effective representation state. */
function resourceRepresentation(entity: MapResourceEntity | undefined): string {
  const value = entity?.representation;
  if (typeof value === "string") return value;
  if (value?.state === "current") return value.value ?? "unknown";
  return value?.state ?? "unknown";
}

/** Returns the lifecycle or local-target status useful in compact CLI output. */
function resourceState(entity: MapResourceEntity | undefined): string {
  if (entity?.reason) return `gone: ${entity.reason}`;
  const lifecycle = entity?.link?.lifecycle;
  if (lifecycle?.value?.stateLabel) return `${lifecycle.value.stateLabel}${lifecycle.state === "last-known" ? " · Last known" : ""}`;
  if (lifecycle?.state && !["not-checked", "current"].includes(lifecycle.state)) return lifecycle.state;
  const local = entity?.local;
  if (local?.value?.state) return `${local.value.state}${local.state === "last-known" ? " · Last known" : ""}`;
  return local?.state ?? "";
}

/** Returns a short, copyable identifier while keeping prefix ambiguity detectable. */
function shortResourceId(locator: MapResourceLocator | undefined): string {
  return locator?.id ? locator.id.slice(0, 12) : "unknown";
}

/** Prints the complete confirmed inventory plus pending review and suggestion identities. */
function printResourceProjection(area: string, projection: MapResourceProjection): void {
  console.log(`Map resources · ${area} [${projection.state ?? "unknown"}]`);
  const rows = projection.rows ?? [];
  if (!rows.length) console.log(projection.state === "current" ? "  No confirmed Map resources." : "  No current confirmed rows.");
  for (const row of rows) {
    const entity = row.entity;
    const locator = entity?.locator;
    const target = resourceTarget(entity);
    const relation = row.relation?.kind === "inherited" ? `from ${row.relation.sourceArea ?? locator?.owner}` : "direct";
    const state = resourceState(entity);
    console.log(`  ${shortResourceId(locator)}  ${target?.kind ?? "resource"}  ${entity?.label ?? entity?.lastKnown?.label ?? "Unlabelled"}  [${relation}; ${resourceRepresentation(entity)}${state ? `; ${state}` : ""}]`);
    console.log(`    ${resourceTargetText(target)}`);
  }
  const legacy = (projection.legacyReview ?? []).filter((item) => item.state !== "invalid");
  if (legacy.length) {
    console.log("Legacy resources to review:");
    for (const item of legacy) console.log(`  legacy:${String(item.targetFingerprint ?? item.evidenceHash ?? "unknown").slice(0, 12)}  ${item.target?.kind ?? item.field ?? "resource"}  ${resourceTargetText(item.target)}`);
  }
  for (const item of (projection.legacyReview ?? []).filter((candidate) => candidate.state === "invalid")) console.log(`  Legacy review problem: ${item.message ?? "invalid declaration"}`);
  if (projection.suggestions?.length) {
    console.log("Suggestions:");
    for (const item of projection.suggestions) console.log(`  suggestion:${String(item.targetFingerprint ?? item.evidenceHash ?? "unknown").slice(0, 12)}  ${item.target?.kind ?? "resource"}  ${resourceTargetText(item.target)}  (${item.provenanceLabel ?? "evidence"})`);
  }
  for (const problem of projection.problems ?? []) console.log(`  Problem: ${problem.error?.message ?? problem.message ?? problem.kind ?? "resource source unavailable"}`);
}

/** Lists direct, inherited, removed, legacy-review, and suggested resource rows. */
async function resourceListCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "list");
  const projection = await readResourceProjection(server, area);
  if (booleanArg(args.json)) return printJson(projection);
  printResourceProjection(area, projection);
}

/** Normalizes the prefix syntax printed by list output. */
function cleanResourceSelector(selector: string): string {
  return selector.trim().replace(/^(?:resource|legacy|suggestion):/, "");
}

/** Finds one confirmed row by a full locator or unique resource-ID prefix. */
function findResourceRow(projection: MapResourceProjection, rawSelector: string): MapResourceRow {
  const selector = cleanResourceSelector(rawSelector);
  if (!selector) throw new Error("a resource ID is required");
  const matches = (projection.rows ?? []).filter((row) => {
    const locator = row.entity?.locator;
    return Boolean(locator && (`${locator.owner}:${locator.id}` === rawSelector || locator.id === selector || locator.id.startsWith(selector)));
  });
  const unique = [...new Map(matches.map((row) => [`${row.entity?.locator?.owner}:${row.entity?.locator?.id}`, row])).values()];
  if (!unique.length) throw new Error(`no Map resource matches ${JSON.stringify(rawSelector)} in this Area view`);
  if (unique.length > 1) throw new Error(`${JSON.stringify(rawSelector)} matches ${unique.length} Map resources; use more of the resource ID: ${unique.map((row) => `${row.entity?.locator?.owner}:${row.entity?.locator?.id}`).join(", ")}`);
  return unique[0]!;
}

/** Requires the exact selected-Area association rather than an inherited or gone projection. */
function directMutableResource(row: MapResourceRow, area: string, action: string): MapResourceLocator {
  const locator = row.entity?.locator;
  if (!locator) throw new Error("the selected Map resource has no locator");
  if (row.relation?.kind !== "direct" || locator.owner !== area) throw new Error(`cannot ${action} inherited resource ${locator.id}; change it in ${locator.owner}`);
  if (row.entity?.reason) throw new Error(`resource ${locator.id} is already ${row.entity.reason}`);
  return locator;
}

/** Shows one confirmed association, including its exact action target and provenance. */
async function resourceShowCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "show");
  const selector = requiredString(args._[3], "tangent area resource show requires <area> <resource-id>.");
  const row = findResourceRow(await readResourceProjection(server, area), selector);
  if (booleanArg(args.json)) return printJson(row);
  const entity = row.entity;
  const locator = entity?.locator;
  const target = resourceTarget(entity);
  console.log(`${locator?.owner}:${locator?.id}`);
  console.log(`  label: ${entity?.label ?? entity?.lastKnown?.label ?? "Unlabelled"}`);
  console.log(`  kind: ${target?.kind ?? "unknown"}`);
  console.log(`  target: ${resourceTargetText(target)}`);
  console.log(`  source: ${row.relation?.kind === "inherited" ? `inherited from ${row.relation.sourceArea ?? locator?.owner}` : "direct"}`);
  console.log(`  Map: ${resourceRepresentation(entity)}`);
  const state = resourceState(entity);
  if (state) console.log(`  state: ${state}`);
}

/** Returns one validated operation identity, generated once before a mutation is dispatched. */
function resourceOperationId(args: Args): string {
  const operationId = stringArg(args["operation-id"])?.trim() || randomUUID();
  if (!RESOURCE_OPERATION_ID.test(operationId)) throw new Error("--operation-id must be 1-128 safe letters, numbers, dots, colons, underscores, or hyphens.");
  return operationId;
}

/** Selects the exact current revisions for every catalog a mutation will change. */
function expectedCatalogs(projection: MapResourceProjection, owners: Iterable<string>): CatalogRevision[] {
  const byOwner = new Map((projection.catalogs ?? []).map((item) => [item.owner, item]));
  return [...new Set(owners)].sort().map((owner) => {
    const expectation = byOwner.get(owner);
    if (!expectation) throw new Error(`the resource response has no current catalog revision for ${owner}`);
    return expectation;
  });
}

/** Posts one revision-fenced catalog mutation. */
async function applyResourceMutation(server: URL, area: string, projection: MapResourceProjection, args: Args, mutation: Record<string, unknown>, owners: Iterable<string>): Promise<Record<string, any>> {
  const operationId = resourceOperationId(args);
  return postJson(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: area,
    mutation,
    expectedCatalogs: expectedCatalogs(projection, owners),
  });
}

/** Reads the selected Area's exact raw-source hash and an eager source scene. */
async function readMapSource(server: URL, area: string): Promise<MapSourceShard> {
  const world = await vaultFetch(server, `/api/areas/map-world?located=${encodeURIComponent(area)}`);
  const node = Array.isArray(world.areas) ? world.areas.find((item: any) => item?.key === area) : null;
  let shard = node?.shard as MapSourceShard | undefined;
  if (shard && !shard.scene && typeof world.worldRevision === "string") {
    shard = await vaultFetch(server, `/api/areas/map-shard?area=${encodeURIComponent(area)}&located=${encodeURIComponent(area)}&worldRevision=${encodeURIComponent(world.worldRevision)}`) as MapSourceShard;
  }
  if (!shard || shard.owner !== area) throw new Error(`the Map world has no source shard for ${area}`);
  if (shard.state === "unreadable") throw new Error(`the Map source for ${area} is unreadable`);
  if (typeof shard.hash !== "string" || !shard.hash) throw new Error(`the Map source for ${area} has no exact saved hash`);
  if (!shard.scene || !Array.isArray(shard.scene.elements)) throw new Error(`the Map source for ${area} is not loaded`);
  return shard;
}

/** Resolves one visible generic Link root by exact ID or unambiguous ID prefix. */
function findGenericLinkElement(shard: MapSourceShard, rawSelector: string): MapSourceElement {
  const selector = rawSelector.trim();
  if (!selector) throw new Error("a generic Link source element ID is required");
  const matches = (shard.scene?.elements ?? []).filter((element) => {
    const tangent = element.customData?.tangent;
    return !element.isDeleted && !element.containerId && tangent?.kind === "link"
      && (element.id === selector || element.id?.startsWith(selector));
  });
  if (!matches.length) throw new Error(`no visible generic Link Block matches ${JSON.stringify(rawSelector)} in this Area source`);
  if (matches.length > 1) throw new Error(`${JSON.stringify(rawSelector)} matches ${matches.length} generic Link Blocks; use the full source element ID: ${matches.map((element) => element.id).join(", ")}`);
  return matches[0]!;
}

/** Posts one catalog-plus-scene mutation with both exact authority fences. */
async function applySourceResourceMutation(
  server: URL,
  area: string,
  projection: MapResourceProjection,
  args: Args,
  mutation: Record<string, unknown>,
  sourceOwner: string,
  sourceHash: string,
): Promise<Record<string, any>> {
  const operationId = resourceOperationId(args);
  return postJson(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: area,
    mutation,
    expectedCatalogs: expectedCatalogs(projection, [sourceOwner]),
    expectedScenes: [{ owner: sourceOwner, hash: sourceHash }],
  });
}

/** Returns one supported target kind or a command-specific error. */
function requestedResourceKind(args: Args, fallback = ""): "worktree" | "repository" | "link" {
  const kind = String(stringArg(args.kind) ?? fallback).trim().toLowerCase();
  if (!RESOURCE_KINDS.has(kind)) throw new Error("--kind must be worktree, repository, or link.");
  return kind as "worktree" | "repository" | "link";
}

/** Builds the target submitted to inspect-target from flags or a current target. */
function resourceTargetRequest(args: Args, kind: "worktree" | "repository" | "link", fallback: MapResourceTarget | null = null): Record<string, string> {
  const pathValue = stringArg(args.path);
  const urlValue = stringArg(args.url);
  if (pathValue !== undefined && urlValue !== undefined) throw new Error("use exactly one of --path or --url");
  if (kind === "link") {
    const url = urlValue ?? (fallback?.kind === "link" ? fallback.url : "");
    if (!url) throw new Error("a Link resource requires --url <http-or-https-url>.");
    if (pathValue !== undefined) throw new Error("a Link resource uses --url, not --path.");
    return { kind, url };
  }
  const path = pathValue ?? (fallback && "path" in fallback ? fallback.path : "");
  if (!path) throw new Error(`a ${kind} resource requires --path <absolute-path>.`);
  if (urlValue !== undefined) throw new Error(`a ${kind} resource uses --path, not --url.`);
  return { kind, path };
}

/** Normalizes and rechecks one target, preserving explicit confirmation for a missing local path. */
async function inspectResourceTarget(server: URL, request: Record<string, string>, allowMissing: boolean): Promise<Record<string, unknown>> {
  const response = await postJson(server, "/api/areas/map-resources/inspect-target", request);
  const inspection = (response.inspection ?? response) as Record<string, any>;
  const target = inspection.normalized;
  if (!target || typeof target !== "object") throw new Error("Agent Shell returned no normalized resource target.");
  if (inspection.kind === "local" || target.kind === "worktree" || target.kind === "repository") {
    if (inspection.state === "missing" && !allowMissing) {
      throw new Error(`${resourceTargetText(target as MapResourceTarget)} is missing. Review the exact path, then repeat with --allow-missing to record it as Missing.`);
    }
    return {
      target,
      missingConfirmation: inspection.state === "missing" ? { targetFingerprint: String(inspection.targetFingerprint ?? "") } : null,
    };
  }
  return { target };
}

/** Resolves one Suggestion by an exact target/evidence fingerprint or unique prefix. */
function findSuggestion(projection: MapResourceProjection, rawSelector: string): ResourceSuggestion {
  const selector = cleanResourceSelector(rawSelector);
  const matches = (projection.suggestions ?? []).filter((item) => [item.targetFingerprint, item.evidenceHash].some((value) => value === selector || value?.startsWith(selector)));
  if (!matches.length) throw new Error(`no resource Suggestion matches ${JSON.stringify(rawSelector)}`);
  if (matches.length > 1) throw new Error(`${JSON.stringify(rawSelector)} matches ${matches.length} Suggestions; use more of the printed ID`);
  return matches[0]!;
}

/** Keeps only the evidence identity accepted by add/dismiss mutation commands. */
function suggestionReference(suggestion: ResourceSuggestion): Record<string, unknown> {
  return {
    owner: suggestion.owner,
    target: suggestion.target,
    evidence: suggestion.evidence,
    evidenceHash: suggestion.evidenceHash,
    targetFingerprint: suggestion.targetFingerprint,
  };
}

/** Adds one direct resource or confirms one discovered/Knowledge Suggestion. */
async function resourceAddCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "add");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const suggestionSelector = stringArg(args.suggestion);
  const suggestion = suggestionSelector ? findSuggestion(projection, suggestionSelector) : null;
  const suggestedKind = suggestion?.target?.kind === "local-path" ? "" : suggestion?.target?.kind ?? "";
  const kind = requestedResourceKind(args, suggestedKind);
  const fallback = suggestion?.target ?? null;
  if (fallback?.kind !== "local-path" && fallback && fallback.kind !== kind) throw new Error(`Suggestion ${suggestionSelector} is a ${fallback.kind}; it cannot be added as ${kind}.`);
  const request = resourceTargetRequest(args, kind, fallback);
  const input = await inspectResourceTarget(server, request, booleanArg(args["allow-missing"]));
  const label = stringArg(args.label)?.trim() || null;
  const mutation = suggestion
    ? { kind: "add-suggestion", selection: { suggestion: suggestionReference(suggestion), input }, labelForNewRecord: label }
    : { kind: "add", owner: area, input, label };
  const result = await applyResourceMutation(server, area, projection, args, mutation, [area]);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, suggestion ? "added Suggestion to" : "added resource to", area);
}

/** Associates one existing generic Link Block in place through the scene-coupled mutation contract. */
async function resourceAssociateCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "associate");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], "tangent area resource associate requires <area> <source-element-id>.");
  const source = await readMapSource(server, area);
  const element = findGenericLinkElement(source, selector);
  const sourceElementId = requiredString(element.id, "the selected generic Link Block has no source element ID");
  const suppliedLabel = stringArg(args.label);
  const labelForNewRecord = suppliedLabel === undefined ? null : suppliedLabel.trim();
  const result = await applySourceResourceMutation(server, area, projection, args, {
    kind: "associate-generic-link",
    owner: area,
    sourceElementId,
    labelForNewRecord,
  }, area, source.hash!);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "associated generic Link as a resource in", area);
}

/** Resolves one legacy review candidate by evidence/target fingerprint or unique prefix. */
function findLegacyCandidate(candidates: LegacyResourceCandidate[], rawSelector: string): LegacyResourceCandidate {
  const selector = cleanResourceSelector(rawSelector).toLowerCase();
  const matches = candidates.filter((item) => {
    const kind = item.target?.kind?.toLowerCase();
    return [item.targetFingerprint, item.evidenceHash].some((value) => value === selector || value?.startsWith(selector))
      || kind === selector
      || resourceTargetText(item.target).toLowerCase() === selector;
  });
  if (!matches.length) throw new Error(`no legacy resource matches ${JSON.stringify(rawSelector)}`);
  if (matches.length > 1) throw new Error(`${JSON.stringify(rawSelector)} matches ${matches.length} legacy resources; use the printed legacy ID`);
  return matches[0]!;
}

/** Keeps only the exact reviewed legacy evidence accepted by import. */
function legacyReference(candidate: LegacyResourceCandidate): Record<string, unknown> {
  return {
    owner: candidate.owner,
    target: candidate.target,
    evidence: candidate.evidence,
    evidenceHash: candidate.evidenceHash,
    targetFingerprint: candidate.targetFingerprint,
  };
}

/** Imports one explicit set of legacy Area bindings atomically. */
async function resourceImportCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "import");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const candidates = (projection.legacyReview ?? []).filter((item) => item.state !== "invalid");
  const selectors = [...args._.slice(3).map(String), ...stringsArg(args.candidate)];
  if (booleanArg(args.all) && selectors.length) throw new Error("use --all or name legacy IDs, not both");
  if (!booleanArg(args.all) && !selectors.length) throw new Error("resource import requires --all or one or more printed legacy IDs");
  const selected = booleanArg(args.all) ? candidates : selectors.map((selector) => findLegacyCandidate(candidates, selector));
  const unique = [...new Map(selected.map((item) => [`${item.owner}:${item.evidenceHash}:${item.targetFingerprint}`, item])).values()];
  if (!unique.length) throw new Error("there are no legacy resources to import");
  if (unique.length !== selected.length) throw new Error("the same legacy resource was selected more than once");
  const branchSelector = stringArg(args["branch-to"]);
  const branchTarget = branchSelector ? findLegacyCandidate(unique, branchSelector) : null;
  const selections = unique.map((candidate) => ({
    candidate: legacyReference(candidate),
    attachDeclaredBranch: branchTarget ? branchTarget === candidate : Boolean(candidate.declaredBranch),
  }));
  const owners = unique.map((candidate) => String(candidate.owner ?? ""));
  if (owners.some((owner) => !owner)) throw new Error("a legacy review row has no owning Area");
  const result = await applyResourceMutation(server, area, projection, args, { kind: "import-legacy", selections }, owners);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, `imported ${unique.length} legacy resource${unique.length === 1 ? "" : "s"} into`, area);
}

/** Runs bounded worktree discovery without adding catalog membership or Map Blocks. */
async function resourceDiscoverCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "discover");
  const result = await postJson(server, "/api/areas/map-resources/discover", { area });
  if (booleanArg(args.json)) return printJson(result);
  const suggestions = (result.suggestions ?? result.projection?.suggestions ?? []) as ResourceSuggestion[];
  console.log(`Discovered ${suggestions.length} worktree Suggestion${suggestions.length === 1 ? "" : "s"} for ${area}. Nothing was added or placed.`);
  for (const suggestion of suggestions) console.log(`  suggestion:${String(suggestion.targetFingerprint ?? suggestion.evidenceHash ?? "unknown").slice(0, 12)}  ${resourceTargetText(suggestion.target)}  (${suggestion.provenanceLabel ?? "evidence"})`);
  for (const problem of result.problems ?? []) console.log(`  Problem: ${problem.message ?? problem.error?.message ?? "discovery source unavailable"}`);
}

/** Durably dismisses one exact Suggestion evidence tuple. */
async function resourceDismissCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "dismiss");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], "tangent area resource dismiss requires <area> <suggestion-id>.");
  const suggestion = findSuggestion(projection, selector);
  if (suggestion.owner !== area) throw new Error(`cannot dismiss a Suggestion owned by ${suggestion.owner ?? "another Area"} from ${area}`);
  const result = await applyResourceMutation(server, area, projection, args, { kind: "dismiss-suggestion", suggestion: suggestionReference(suggestion) }, [area]);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "dismissed Suggestion from", area);
}

/** Places, hides, or restores a resource through the server's canonical world-layout adapter. */
async function resourceRepresentationCommand(args: Args, kind: "place" | "hide" | "restore"): Promise<void> {
  const { server, area } = await resourceArea(args, kind);
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], `tangent area resource ${kind} requires <area> <resource-id>.`);
  const row = findResourceRow(projection, selector);
  const resource = row.entity?.locator;
  if (!resource) throw new Error("the selected Map resource has no locator");
  if (row.entity?.reason) throw new Error(`cannot ${kind} a ${row.entity.reason} resource Block`);
  const operationId = resourceOperationId(args);
  const result = await postJson(server, "/api/areas/map-resources/representation", {
    schema: "area-map-resource-representation.v1",
    operationId,
    kind,
    viewedFrom: area,
    resource,
  });
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, kind === "place" ? "placed resource on Map for" : kind === "hide" ? "hid resource Block in" : "restored resource Block in", resource.owner);
}

/** Adds one visible gone Block back under a fresh association identity. */
async function resourceAddBackCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "add-back");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], "tangent area resource add-back requires <area> <resource-id>.");
  const row = findResourceRow(projection, selector);
  const resource = row.entity?.locator;
  if (!resource) throw new Error("the selected gone Map Block has no resource locator");
  if (row.relation?.kind !== "direct" || resource.owner !== area) throw new Error(`cannot add back inherited resource ${resource.id}; change it in ${resource.owner}`);
  const reason = row.entity?.reason;
  if (!reason) throw new Error(`resource ${resource.id} is still current; Add back applies only to a visible gone Block`);
  let source: Record<string, unknown>;
  if (reason === "removed") source = { kind: "tombstone" };
  else if (reason === "missing-record") {
    if (!booleanArg(args["confirm-last-known"])) {
      throw new Error(`resource ${resource.id} has no tombstone. Review its exact Last-known label and target, then repeat with --confirm-last-known.`);
    }
    const target = resourceTarget(row.entity);
    const label = row.entity?.lastKnown?.label;
    if (!target || target.kind === "local-path" || typeof label !== "string") throw new Error(`resource ${resource.id} has no complete Last-known label and target to confirm`);
    const request: Record<string, string> = "path" in target
      ? { kind: target.kind, path: target.path }
      : { kind: target.kind, url: target.url };
    const input = await inspectResourceTarget(server, request, true);
    source = { kind: "confirmed-last-known", input, label };
  } else if (reason === "missing-owner") {
    throw new Error(`resource ${resource.id} has no owning Area. Add its target to another Area, then place a new Block.`);
  } else throw new Error(`resource ${resource.id} cannot be added back from unsupported gone reason ${JSON.stringify(reason)}`);
  const mapSource = await readMapSource(server, resource.owner);
  const result = await applySourceResourceMutation(server, area, projection, args, {
    kind: "add-back-gone",
    oldResource: resource,
    source,
  }, resource.owner, mapSource.hash!);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "added gone Block back to", area);
}

/** Edits one direct association while preserving its stable locator. */
async function resourceEditCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "edit");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], "tangent area resource edit requires <area> <resource-id>.");
  const row = findResourceRow(projection, selector);
  const resource = directMutableResource(row, area, "edit");
  if (booleanArg(args["clear-label"]) && stringArg(args.label) !== undefined) throw new Error("use --label or --clear-label, not both");
  const currentTarget = resourceTarget(row.entity);
  if (!currentTarget) throw new Error(`resource ${resource.id} has no current target to edit`);
  const targetChanged = stringArg(args.path) !== undefined || stringArg(args.url) !== undefined || stringArg(args.kind) !== undefined;
  const labelChanged = stringArg(args.label) !== undefined || booleanArg(args["clear-label"]);
  if (!targetChanged && !labelChanged) throw new Error("resource edit needs --label, --clear-label, --path, --url, or --kind");
  const kind = requestedResourceKind(args, currentTarget.kind === "local-path" ? "" : currentTarget.kind);
  const input = await inspectResourceTarget(server, resourceTargetRequest(args, kind, currentTarget), booleanArg(args["allow-missing"]));
  const label = booleanArg(args["clear-label"]) ? null : stringArg(args.label)?.trim() || row.entity?.label || null;
  const result = await applyResourceMutation(server, area, projection, args, { kind: "edit", resource, input, label }, [resource.owner]);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "edited resource in", area);
}

/** Tombstones one direct association without hiding or deleting its Map Block. */
async function resourceRemoveCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "remove");
  const projection = writableResourceProjection(await readResourceProjection(server, area));
  const selector = requiredString(args._[3], "tangent area resource remove requires <area> <resource-id>.");
  const row = findResourceRow(projection, selector);
  const resource = directMutableResource(row, area, "remove");
  const result = await applyResourceMutation(server, area, projection, args, { kind: "remove", resource }, [resource.owner]);
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "removed resource from", area);
}

/** Checks selected resources, or every current row, without changing catalog or Map authority. */
async function resourceRefreshCommand(args: Args): Promise<void> {
  const command = String(args._[1] ?? "refresh");
  const { server, area } = await resourceArea(args, command);
  const projection = await readResourceProjection(server, area);
  const selectors = args._.slice(3).map(String);
  const rows = selectors.length ? selectors.map((selector) => findResourceRow(projection, selector)) : projection.rows ?? [];
  const resources = [...new Map(rows.filter((row) => !row.entity?.reason && row.entity?.locator).map((row) => [`${row.entity!.locator!.owner}:${row.entity!.locator!.id}`, row.entity!.locator!])).values()];
  if (!resources.length) throw new Error(`no current Map resources in ${area} to ${command}`);
  if (resources.length > 500) throw new Error("one resource refresh can check at most 500 resources");
  const result = await postJson(server, "/api/areas/map-resources/refresh", { resources });
  if (booleanArg(args.json)) return printJson(result);
  const outcomes = (result.results ?? result.resources ?? []) as Array<Record<string, any>>;
  console.log(`Checked ${resources.length} Map resource${resources.length === 1 ? "" : "s"} for ${area}.`);
  for (const [index, outcome] of outcomes.entries()) {
    const locator = outcome.locator ?? resources[index];
    const observation = outcome.local ?? outcome.lifecycle ?? outcome.observation ?? outcome;
    console.log(`  ${locator?.owner}:${locator?.id}  ${observation.state ?? outcome.state ?? "checked"}`);
  }
}

/** Applies the one process-local catalog Undo token returned by a prior mutation. */
async function resourceUndoCommand(args: Args): Promise<void> {
  const { server, area } = await resourceArea(args, "undo");
  const token = requiredString(args._[3], "tangent area resource undo requires <area> <token>.");
  const operationId = resourceOperationId(args);
  const result = await postJson(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: area,
    mutation: { kind: "undo", token },
  });
  if (booleanArg(args.json)) return printJson(result);
  printResourceMutationResult(result, "undid the last resource change in", area);
}

/** Prints a compact mutation receipt that remains safe after an ambiguous transport retry. */
function printResourceMutationResult(result: Record<string, any>, action: string, area: string): void {
  console.log(`${action} ${area}.`);
  const operationId = String(result.operationId ?? "");
  if (operationId) console.log(`  operation: ${operationId}${result.idempotent || result.replayed ? " (replayed)" : ""}`);
  const locator = result.resource?.locator ?? result.locator ?? null;
  if (locator?.owner && locator?.id) console.log(`  resource: ${locator.owner}:${locator.id}`);
  const undo = result.undo?.state === "available" ? result.undo.token : null;
  if (undo) console.log(`  undo: tangent area resource undo ${area} ${undo}`);
  for (const warning of result.warnings ?? []) console.log(`  warning: ${warning.kind ?? "resource warning"}${warning.other ? ` (${warning.other.owner}:${warning.other.id})` : ""}`);
}

/** Prints nested resource help from the same command specification as completion. */
function resourceHelp(command = ""): void {
  const resource = areaCommandSpec.subcommands?.find((item) => item.name === "resource");
  const selected = command ? resource?.subcommands?.find((item) => item.name === command) : resource;
  console.log(renderCommandHelp(selected ?? resource ?? areaCommandSpec, command ? `tangent area resource ${command}` : "tangent area resource"));
}

/** Handles `tangent area show <area>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area show requires <area>."));
  const detail = await vaultFetch(server, `/api/areas/show?area=${encodeURIComponent(area)}`);
  if (booleanArg(args.json)) {
    const concise = { ...detail };
    delete concise.goals;
    console.log(JSON.stringify(concise, null, 2));
    return;
  }
  console.log(detail.area);
  if (HIDDEN_AREA_STATUSES.has(detail.status ?? "")) console.log(`status: ${detail.status}`);
  if (detail.purpose) {
    console.log("");
    console.log("Purpose:");
    console.log(detail.purpose);
  }
  printResources(detail);
  printAreaShowMapResources(detail);
  printSkills(detail);
  printProcesses(detail);
  if (detail.map) {
    console.log("");
    console.log(`Map: ${detail.map.exists ? detail.map.file : "none"}`);
    for (const reference of detail.map.references ?? []) console.log(`  reference: ${reference.file ?? reference.url}${reference.subpath ?? ""}`);
    for (const ink of detail.map.ink ?? []) console.log(`  ink: ${ink.text}`);
    for (const frame of detail.map.frames ?? []) console.log(`  frame: ${frame.label}`);
    for (const arrow of detail.map.arrows ?? []) console.log(`  arrow: ${arrow.from} -> ${arrow.to}${arrow.label ? ` (${arrow.label})` : ""}`);
    for (const proposal of detail.map.proposals ?? []) console.log(`  proposal: ${proposal.id} ${proposal.note}`);
  }
}

/**
 * Prints the resource lines the Area sees, each with the Area that declared
 * it, and the folder a worker starts in, so a brain reading
 * `tangent area show` knows where the Area's work runs without opening the
 * note.
 */
function printResources(detail: AreaShowDetail): void {
  const resolved = detail.resolved ?? {};
  const lines = [
    ["Repository", resolved.repository],
    ["Worktree", resolved.worktree],
    ["Branch", resolved.branch],
  ].filter((entry): entry is [string, ResolvedResource] => Boolean(entry[1]));
  console.log("");
  console.log("Resources:");
  if (!lines.length) console.log("  Repository: none bound");
  for (const [label, item] of lines) console.log(`  ${label}: ${item.value} (from ${item.area})`);
  if (detail.workFolder) console.log(`  Workers start in ${detail.workFolder.cwd} (from ${detail.workFolder.source})`);
}

/** Prints the additive active Map-resource projection without starting checks or discovery. */
function printAreaShowMapResources(detail: AreaShowDetail): void {
  const projected = detail.mapResources;
  if (!projected) return;
  console.log("");
  console.log("Map resources:");
  if (projected.state === "unavailable") {
    console.log(`  Unavailable: ${projected.error?.message ?? "catalog could not be read"}`);
    return;
  }
  if (!projected.rows.length) console.log(projected.state === "current" ? "  None." : "  No confirmed rows loaded.");
  for (const row of projected.rows) {
    const source = row.source.kind === "inherited" ? `inherited from ${row.source.sourceArea}` : "direct";
    console.log(`  ${row.locator.id.slice(0, 12)}  ${row.target.kind}  ${row.label}  (${source}; ${row.locator.owner})`);
    console.log(`    ${resourceTargetText(row.target)}`);
  }
  if (projected.state === "partial") for (const problem of projected.problems ?? []) {
    console.log(`  Problem: ${problem.message ?? "catalog source unavailable"}`);
  }
}

/**
 * Prints the Area's processes with their next run, so a brain reading
 * `tangent area show` knows what repeatable work exists and when it is due
 * (D16). Nothing prints when the Area has none.
 */
function printProcesses(detail: AreaShowDetail): void {
  const processes = detail.processes ?? [];
  if (!processes.length) return;
  console.log("");
  console.log("Processes:");
  for (const item of processes) {
    const next = item.status === "paused" ? "paused" : item.nextRunAt ? `next ${item.nextRunAt}` : "no next run";
    console.log(`  ${item.slug}: ${item.when}; ${next}; ${item.error ? `broken note: ${item.error}` : item.state} (${item.file})`);
  }
}

/**
 * Prints the skills a brain can hand to a worker: every agent skill
 * on the route from the vault root to this Area, root first, then the
 * bound repository's own project skills. Names and descriptions only, the
 * way a harness lists skills. Nothing prints when there are none.
 */
function printSkills(detail: AreaShowDetail): void {
  const skills = [...(detail.skills ?? []), ...(detail.projectSkills ?? [])];
  if (!skills.length) return;
  console.log("");
  console.log("Skills:");
  for (const skill of skills) console.log(`  - ${skill.name}: ${skill.description} (${skill.path})`);
}

/** One skill row of `/api/areas/show`. */
type AreaShowSkill = { name: string; description: string; path: string };

/** One process row of `/api/areas/show`. */
type AreaShowProcess = { slug: string; file: string; when: string; status: string; nextRunAt: string | null; state: string; error: string | null };

/** One resource value with the Area whose note declares it. */
type ResolvedResource = { value: string; area: string };

/** One active Map-resource row from the additive Area-show contract. */
type AreaShowMapResourceRow = {
  locator: MapResourceLocator;
  label: string;
  target: MapResourceTarget;
  source: { kind: "direct" } | { kind: "inherited"; sourceArea: string };
};

/** The additive Area-show resource projection, kept distinct from launch bindings. */
type AreaShowMapResources =
  | { state: "current"; rows: AreaShowMapResourceRow[] }
  | { state: "partial"; rows: AreaShowMapResourceRow[]; problems?: Array<{ message?: string }> }
  | { state: "unavailable"; error?: { message?: string } };

/** The parts of `/api/areas/show` the resource printout reads. */
type AreaShowDetail = {
  resolved?: { repository?: ResolvedResource | null; worktree?: ResolvedResource | null; branch?: ResolvedResource | null };
  workFolder?: { cwd: string; source: string } | null;
  processes?: AreaShowProcess[];
  skills?: AreaShowSkill[];
  projectSkills?: AreaShowSkill[];
  mapResources?: AreaShowMapResources;
};

/**
 * Handles `tangent area create <parent> <name>`: the same route the desk uses, so an agent
 * (the Area brain, a describe-work agent) creates a sub-Area with the desk's note shape and
 * a provenance commit instead of hand-writing the vault.
 */
async function createCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const parent = await requireArea(server, requiredString(args._[1], "tangent area create requires <parent> <name>."));
  const name = args._.slice(2).map(String).join(" ").trim();
  if (!name) throw new Error("tangent area create requires <name> after the parent Area.");
  const caller = await currentTmuxSession();
  const created = await postJson(server, "/api/areas/new", { parent, name, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(created, null, 2));
    return;
  }
  console.log(`area: ${created.area}`);
  console.log(`note: ${created.note}`);
}

/**
 * Handles `tangent area done <area>`, `tangent area archive <area>`, and `tangent area reopen <area>`.
 * Status is written on Julian's explicit word only, as `tangent goal done` is: an Area with no open
 * work is not done until he says so. Goals inside the Area are not changed. Done is a finished
 * subject, archived a shelved one. Both fold away. Reopen returns either to active.
 */
async function statusCommand(args: Args, status: "done" | "archived" | "active"): Promise<void> {
  const verb = status === "done" ? "done" : status === "archived" ? "archive" : "reopen";
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], `tangent area ${verb} requires <area>.`));
  const result = await postJson(server, "/api/areas/status", { area, status, session: await currentTmuxSession() });
  const open = Number(result.openGoals ?? 0);
  if (status === "active") console.log(`${area} reopened.`);
  else console.log(`${area} ${status === "done" ? "marked done" : "archived"}.${open ? ` ${open} open Goal${open === 1 ? " stays" : "s stay"} open and hidden.` : ""}`);
}

/** Prints `tangent area` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(areaCommandSpec));
  console.log(`
Examples:
  tangent area list
  tangent area list --json
  tangent area show otto/tangent
  tangent area resource list otto/tangent
  tangent area resource add otto/tangent --kind worktree --path /absolute/path --operation-id brain-add-worktree-1
  tangent area resource place otto/tangent <resource-id> --operation-id brain-place-worktree-1
  tangent area create otto/tangent "Area map"
  tangent area archive neara/hackathon
  tangent area list --all
  tangent area done neara/hackathon
  tangent area reopen neara/hackathon
`);
}
