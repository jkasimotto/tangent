import { booleanArg, numberArg, stringArg, type Args } from "../args.js";
import { startEvalUiServer } from "../../server/index.js";

export async function uiCommand(args: Args): Promise<void> {
  const runId = stringArg(args._[1]) || "latest";
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

function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      void close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
