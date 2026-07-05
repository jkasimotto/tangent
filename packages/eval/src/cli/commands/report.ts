import { writeFile } from "node:fs/promises";
import path from "node:path";

import { booleanArg, requiredString, stringArg, type Args } from "../args.js";
import { collectEval } from "../../core/metrics.js";
import { renderReport } from "../../core/report-renderer.js";
import { loadReportModel } from "../../report/model.js";
import { renderMarkdownReport } from "../../report/markdown.js";
import { renderHtmlReport } from "../../report/html.js";
import { resolveRunId } from "./shared.js";

const formatExtensions: Record<"md" | "html", string> = { md: "report.md", html: "report.html" };

/**
 * Handles the `eval report` subcommand. With no `--format`, prints the existing tabular terminal report
 * unchanged (the default behavior predates the report renderers and stays exactly as it was). With
 * `--format md|html`, writes the rendered report artifact to `--out`, or to `report.md`/`report.html` in
 * the run directory when `--out` is omitted.
 */
export async function reportCommand(args: Args): Promise<void> {
  const runId = await resolveRunId(requiredString(args._[1], "eval report requires <run-id>."));
  const result = await collectEval(runId);
  const format = parseFormat(args.format);

  if (!format) {
    if (booleanArg(args.json)) {
      console.log(JSON.stringify(result.metrics, null, 2));
      return;
    }
    console.log(renderReport(result.manifest.id, result.metrics));
    return;
  }

  const isHtml = format === "html";
  const model = await loadReportModel(result.manifest, { includeTranscripts: isHtml, includeContextDiff: isHtml });
  const rendered = isHtml ? renderHtmlReport(model) : renderMarkdownReport(model);
  const outPath = stringArg(args.out) || path.join(result.manifest.runDir, formatExtensions[format]);
  await writeFile(outPath, rendered, "utf8");
  console.log(outPath);
}

/** Parses and validates the `--format` flag, returning undefined when it was not passed. */
function parseFormat(value: unknown): "md" | "html" | undefined {
  const raw = stringArg(value);
  if (!raw) return undefined;
  if (raw === "md" || raw === "html") return raw;
  throw new Error("--format must be md or html.");
}
