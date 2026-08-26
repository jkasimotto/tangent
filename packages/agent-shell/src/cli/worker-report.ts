import { stringArg } from "@tangent/core/cli";

/** Parses an optional worker report and refuses shell-damaged values. */
export function parseWorkerReportOption(args: Record<string, unknown>): object | undefined {
  if (!Object.hasOwn(args, "report")) return undefined;
  const value = stringArg(args.report);
  if (!value?.trim()) throw reportSyntaxError("The --report value is missing.");
  try {
    const report = JSON.parse(value);
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw reportSyntaxError("The --report value is not a JSON object.");
    }
    return report;
  } catch (error) {
    if (error instanceof Error && error.name === "WorkerReportSyntaxError") throw error;
    throw reportSyntaxError("The --report value is malformed or truncated JSON.");
  }
}

/** One recovery message for every local report syntax failure. */
function reportSyntaxError(problem: string): Error {
  const error = new Error(`${problem} Retry with --report '<one complete JSON object>' and keep the facts in a separate quoted argument. Nothing was submitted.`);
  error.name = "WorkerReportSyntaxError";
  return error;
}

/** Prints the durable destination evidence returned by the Goal queue. */
export function workerHandoverResultLine(result: Record<string, any>): string {
  const receipt = result.receipt && typeof result.receipt === "object" ? result.receipt : null;
  if (!receipt) return result.status === "reported"
    ? "reported to the brain; the brain chooses what happens next"
    : "handover recorded";
  const area = String(receipt.destinationArea ?? "the exact Area");
  const revision = Number.isInteger(receipt.queue?.revisionAfter) ? `queue revision ${receipt.queue.revisionAfter}` : "the authoritative queue";
  const notice = receipt.notice?.id ? `notice ${String(receipt.notice.id)}` : "a durable notice";
  const repeated = result.status === "repeated" ? " (exact retry)" : "";
  return `reported to ${area} brain; ${revision}; ${notice}${repeated}`;
}
