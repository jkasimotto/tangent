// Thin route handlers for the marks inbox API: list/get/update over the per-file JSON store in
// ../marks/store.ts. Kept out of server/index.ts, which is already near the file-size limit, following
// the same extraction as report-export.ts and evaluation-read.ts. See
// docs/superpowers/specs/2026-07-05-mark-loop-design.md, "The marks inbox (eval UI)".

import type http from "node:http";

import { listMarks, marksHome, readMark, updateMark, type MarkListFilter, type MarkUpdatePatch } from "../marks/store.js";
import { isMarkKind, isMarkStatus, type MarkLinks, type MarkRecord } from "../marks/types.js";
import { readJsonBody } from "./http-body.js";

/** Lists marks matching the request's status/kind query filters, newest first. `baseDir` defaults to the real marks home; tests pass a temp directory. */
export async function listMarksRoute(url: URL, baseDir = marksHome()): Promise<{ marks: MarkRecord[] }> {
  return { marks: await listMarks(marksFilterFromUrl(url), baseDir) };
}

/** Reads one mark by id, throwing a 404-tagged error when it does not exist. */
export async function getMarkRoute(id: string, baseDir = marksHome()): Promise<MarkRecord> {
  return requireMark(id, baseDir);
}

/**
 * Applies a status/links patch to one mark. Callers gate this behind the read-only verify harness
 * themselves (marks are cheap local-file edits, but the harness blocks every mutating endpoint uniformly
 * so a verification run can never leave a trace in real mark data).
 */
export async function updateMarkRoute(id: string, request: http.IncomingMessage, baseDir = marksHome()): Promise<MarkRecord> {
  await requireMark(id, baseDir); // 404s before attempting the patch, rather than surfacing updateMark's generic read failure.
  return updateMark(id, await readMarkUpdatePatch(request), baseDir);
}

/** Reads and validates one mark, tagging a missing mark as a 404 for the route dispatcher. */
async function requireMark(id: string, baseDir: string): Promise<MarkRecord> {
  try {
    return await readMark(id, baseDir);
  } catch {
    const error = new Error(`Mark not found: ${id}`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
}

/** Builds a mark list filter from status/kind query params, validating known enum values. */
function marksFilterFromUrl(url: URL): MarkListFilter {
  const status = url.searchParams.get("status") ?? undefined;
  const kind = url.searchParams.get("kind") ?? undefined;
  if (status !== undefined && !isMarkStatus(status)) throw new Error(`Invalid status filter: ${status}`);
  if (kind !== undefined && !isMarkKind(kind)) throw new Error(`Invalid kind filter: ${kind}`);
  return { status, kind };
}

/** Reads and validates a mark update request body into a store patch. */
async function readMarkUpdatePatch(request: http.IncomingMessage): Promise<MarkUpdatePatch> {
  const body = await readJsonBody(request);
  const patch: MarkUpdatePatch = {};
  const status = body.status;
  if (status !== undefined) {
    if (!isMarkStatus(status)) throw new Error(`Invalid status: ${String(status)}`);
    patch.status = status;
  }
  const links = body.links;
  if (links !== undefined) {
    if (typeof links !== "object" || links === null) throw new Error("links must be an object.");
    patch.links = links as Partial<MarkLinks>;
  }
  return patch;
}
