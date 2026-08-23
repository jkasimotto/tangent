import pty from "node-pty";
import { WebSocketServer } from "ws";

/** Attaches the durable tmux terminal transport to an HTTP server. */
export function attachTerminalTransport(server, { port, workspace, chatSession, chatCommand }) {
  const wss = new WebSocketServer({ server, path: "/term" });
  wss.on("connection", (socket, request) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    const session = url.searchParams.get("session") ?? chatSession;
    const cols = Number(url.searchParams.get("cols") ?? 120);
    const rows = Number(url.searchParams.get("rows") ?? 32);
    const args = ["new-session", "-A", "-s", session, "-c", workspace];
    if (session === chatSession) {
      const shell = process.env.SHELL ?? "/bin/zsh";
      args.push(`exec ${shell} -ic '${chatCommand.replace(/'/g, "'\\''")}'`);
    }
    const terminal = pty.spawn("tmux", args, {
      name: "xterm-256color", cols, rows, cwd: workspace,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    terminal.onData((data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    });
    terminal.onExit(() => socket.close());
    socket.on("message", (raw) => {
      const text = raw.toString();
      if (text.startsWith("\x00resize:")) {
        const [nextCols, nextRows] = text.slice(8).split("x").map(Number);
        if (nextCols > 0 && nextRows > 0) terminal.resize(nextCols, nextRows);
      } else {
        terminal.write(text);
      }
    });
    socket.on("close", () => terminal.kill());
  });
  return wss;
}
