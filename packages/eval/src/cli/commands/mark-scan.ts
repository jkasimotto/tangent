import { booleanArg, numberArg, stringArg, type Args } from "../args.js";
import { scanForSuggestedMarks, type ScanCategoryCounts, type ScanResult } from "../../marks/scan.js";

/** The CLI-level default judge model for `tangent mark scan`; the library itself takes no default, per ADR-0013. */
const DEFAULT_SCAN_MODEL = "haiku";

/**
 * Handles `tangent mark scan`: runs the phase-3 sweep over recent conversations and prints the
 * summary plus each written (or, with `--dry-run`, would-be) suggested mark.
 */
export async function markScanCommand(args: Args): Promise<void> {
  const dryRun = booleanArg(args["dry-run"]);
  const result = await scanForSuggestedMarks({
    days: numberArg(args.days),
    repo: stringArg(args.repo),
    model: stringArg(args.model) || DEFAULT_SCAN_MODEL,
    limit: numberArg(args.limit),
    dryRun
  });
  printScanResult(result, dryRun);
}

/** Prints the scan summary and one line per written or would-be mark. */
function printScanResult(result: ScanResult, dryRun: boolean): void {
  const { summary, marks } = result;
  const writtenLabel = dryRun ? "would write" : "wrote";
  console.log(
    `scan: ${summary.conversationsScanned} conversation(s) considered, ${summary.modelCalls} model call(s) ` +
    `(${summary.skippedResponses} skipped), ${writtenLabel} ${summary.marksWritten} mark(s)`
  );
  console.log(`by category: ${formatCategoryCounts(summary.byCategory)}`);
  if (!marks.length) {
    console.log("No suggested marks.");
    return;
  }
  console.log("");
  for (const mark of marks) {
    console.log(`${mark.id}  ${mark.kind}  ${truncate(mark.observed, 88)}`);
  }
}

/** Renders per-category incident counts as one compact "category=count" line. */
function formatCategoryCounts(counts: ScanCategoryCounts): string {
  return (Object.keys(counts) as Array<keyof ScanCategoryCounts>).map((category) => `${category}=${counts[category]}`).join(" ");
}

/** Truncates text to a max length for compact list output, appending an ellipsis when cut. */
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
