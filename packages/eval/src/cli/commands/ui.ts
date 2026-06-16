import { booleanArg, numberArg, stringArg, type Args } from "../args.js";
import { startEvalUiServer } from "../../server/index.js";
import { resolveRunId } from "./shared.js";

/** Starts the read-only Eval UI server from CLI args. */
export async function uiCommand(args: Args): Promise<void> {
  const target = stringArg(args._[1]);
  const runId = target ? await resolveRunId(target) : undefined;
  const server = await startEvalUiServer({
    runId,
    host: stringArg(args.host) || "127.0.0.1",
    port: numberArg(args.port) ?? 0,
    open: !booleanArg(args["no-browser"])
  });
  if (booleanArg(args.json)) console.log(JSON.stringify({ url: server.url, runId: server.runId }, null, 2));
  else console.log(`Eval UI: ${server.url}`);
  await waitForInterrupt(server.close);
}

/** Keeps the UI process alive until an interrupt signal arrives. */
function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    /** Stops the server and resolves the wait. */
    const stop = () => {
      void close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
