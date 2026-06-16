import { booleanArg, numberArg, stringArg, stringsArg, type Args } from "@tangent/core/cli";
import { startUsageUiServer } from "../server/index.js";

/** Starts the Usage UI from the Usage CLI. */
export async function usageUiCommand(args: Args): Promise<void> {
  const target = stringArg(args._[1]);
  const server = await startUsageUiServer({
    sessionId: target,
    repo: stringArg(args.repo) || ".",
    scope: stringArg(args.scope) === "all" ? "all" : "repo",
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
