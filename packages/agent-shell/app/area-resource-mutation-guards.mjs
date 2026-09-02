import os from "node:os";

import { areaAncestors } from "./area-agent-command.mjs";
import { safeAreaResourceOwner } from "./area-resource-catalog.mjs";
import { readAreaResourceNoteEvidence } from "./area-resource-projection.mjs";

/** Returns one canonical Area-note path without accepting the logical root. */
function noteFile(owner) {
  if (!safeAreaResourceOwner(owner)) throw Object.assign(new Error("A resource authority owner is unsafe."), { status: 422, code: "invalid-resource-target" });
  return `${owner}/${owner.split("/").at(-1)}.md`;
}

/** Decodes exact evidence bytes without accepting replacement characters. */
function noteText(content, owner) {
  if (content === null) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch {
    throw Object.assign(new Error(`The Area note for ${owner} is not valid UTF-8.`), {
      status: 409,
      code: "resource-source-invalid",
      retryable: false,
    });
  }
}

/** Creates exact note guards and evidence from one co-snapshotted byte set. */
export function createAreaResourceMutationGuardReader({
  transactions,
  readCatalog,
  discoverySuggestions = () => [],
  home = os.homedir(),
} = {}) {
  if (!transactions?.readExact || typeof readCatalog !== "function") throw new TypeError("resource mutation guards require exact note and catalog readers");

  return async function resourceMutationGuards({ viewedFrom, owners, needsEvidence }) {
    if (!safeAreaResourceOwner(viewedFrom) || !Array.isArray(owners) || owners.some((owner) => !safeAreaResourceOwner(owner))) {
      throw Object.assign(new Error("Resource mutation guard owners are invalid."), { status: 422, code: "invalid-resource-target" });
    }
    const evidenceOwners = new Set(needsEvidence ? owners : []);
    const statusOwners = [...new Set(owners.flatMap((owner) => areaAncestors(owner)))].sort();
    const notes = new Map(await Promise.all(statusOwners.map(async (owner) => {
      const file = noteFile(owner);
      let exact;
      try { exact = await transactions.readExact(file); }
      catch (error) {
        throw Object.assign(new Error(`The Area note for ${owner} could not be loaded.`), {
          status: Number(error?.status ?? 503),
          code: error?.code ?? "resource-source-load-failed",
          retryable: error?.retryable !== false,
        });
      }
      return [owner, { owner, file, content: exact.content, text: noteText(exact.content, owner) }];
    })));

    const guards = statusOwners.map((owner) => {
      const note = notes.get(owner);
      return { file: note.file, oldContent: note.content, kind: evidenceOwners.has(owner) ? "evidence" : "status" };
    });
    if (!needsEvidence) return { guards, evidence: null };

    const reads = await Promise.all([...evidenceOwners].sort().map(async (owner) => {
      const catalog = await readCatalog(owner);
      if (catalog?.state !== "current" || !catalog.catalog) {
        throw Object.assign(new Error(`Map resources for ${owner} could not be loaded.`), {
          status: Number(catalog?.error?.status ?? 503),
          code: catalog?.error?.code ?? "catalog-load-failed",
          retryable: catalog?.error?.retryable !== false,
        });
      }
      return readAreaResourceNoteEvidence(owner, notes.get(owner)?.text ?? "", { catalog: catalog.catalog, home });
    }));
    const retained = await discoverySuggestions(viewedFrom);
    return {
      guards,
      evidence: {
        state: "current",
        owner: viewedFrom,
        legacyReview: reads.flatMap((read) => read.legacyReview ?? []),
        suggestions: [...reads.flatMap((read) => read.suggestions ?? []), ...(Array.isArray(retained) ? retained : [])],
      },
    };
  };
}

export default { createAreaResourceMutationGuardReader };
