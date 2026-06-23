import { booleanArg, numberArg, stringArg, stringsArg, type Args } from "@tangent/core/cli";
import { startUsageUiServer } from "../server/index.js";

/** Starts the Usage UI from the Usage CLI. */
export async function usageUiCommand(args: Args): Promise<void> {
  const target = stringArg(args._[1]);
  const server = await startUsageUiServer({
    sessionId: target,
    repo: stringArg(args.repo) || ".",
    // Default to every project so the panel is a cross-project view; `--scope repo` limits it to one.
    scope: stringArg(args.scope) === "repo" ? "repo" : "all",
    // Default to the last 7 days to keep the global index fast; `--days N` widens it, `--days all` loads everything.
    windowDays: windowDaysArg(stringArg(args.days)),
    providers: stringsArg(args.provider),
    sources: stringsArg(args.source),
    host: stringArg(args.host) || "127.0.0.1",
    port: numberArg(args.port) ?? 0,
    open: !booleanArg(args["no-browser"]),
    dev: !booleanArg(args["static-ui"])
  });
  if (booleanArg(args.json)) console.log(JSON.stringify({ url: server.url, sessionId: server.sessionId, dev: server.dev }, null, 2));
  else console.log(`Usage UI: ${server.url}${server.dev ? " (hot reload)" : ""}`);
  await waitForInterrupt(server.close);
}

/** Parses `--days`: a positive number of days, or `all`/`0` for no window. Defaults to 7. */
function windowDaysArg(value: string | undefined): number {
  if (value === undefined) return 7;
  if (value === "all" || value === "0") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

/** Keeps the UI server alive until the process is interrupted. */
function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    /** Stops the UI server and resolves the command. */
    const stop = () => {
      void close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
