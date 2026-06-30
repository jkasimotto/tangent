import { describe, expect, it } from "vitest";
import { alignBySource, concatBlocks } from "./assembled-model.js";
import type { EvalAssembledBlock } from "./client.js";

/** Builds a test block with the given source, text, and optional kind. */
const block = (source: string, text: string, kind: EvalAssembledBlock["kind"] = "claude-md"): EvalAssembledBlock => ({ kind, source, text });

describe("assembled-model", () => {
  it("concatBlocks joins verbatim text without provenance chrome", () => {
    expect(concatBlocks([block("a", "one"), block("b", "two")])).toBe("one\n\ntwo");
  });

  it("alignBySource marks right-only, left-only, changed, and same by source", () => {
    const left = [block("/CLAUDE.md", "root")];
    const right = [block("/CLAUDE.md", "root changed"), block("/client/CLAUDE.md", "client")];
    const rows = alignBySource(left, right);
    const bySource = Object.fromEntries(rows.map((row) => [row.source, row.status]));
    expect(bySource["/CLAUDE.md"]).toBe("changed");
    expect(bySource["/client/CLAUDE.md"]).toBe("right-only");
  });
});
