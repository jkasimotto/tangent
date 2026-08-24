import pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

const MAX_TERMINAL_BUFFER_BYTES = 1024 * 1024;

/** Clamps an untrusted terminal dimension to a practical tmux range. */
function dimension(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

/** Attaches the durable tmux terminal transport to an HTTP server. */
export function attachTerminalTransport(server, { port, workspace, chatSession, chatCommand, maxConnections = 128 }) {
  const wss = new WebSocketServer({ server, path: "/term", maxPayload: 64 * 1024, perMessageDeflate: false });
  wss.on("connection", (socket, request) => {
    if (wss.clients.size > maxConnections) {
      socket.close(1013, "too many terminal connections");
      return;
    }
    let url;
    try {
      url = new URL(request.url, `http://localhost:${port}`);
    } catch {
      socket.close(1008, "invalid terminal URL");
      return;
    }
    const session = String(url.searchParams.get("session") ?? chatSession);
    if (!session || session.length > 128 || /[\u0000-\u001f\u007f]/.test(session)) {
      socket.close(1008, "invalid tmux session");
      return;
    }
    const cols = dimension(url.searchParams.get("cols"), 120, 20, 500);
    const rows = dimension(url.searchParams.get("rows"), 32, 5, 200);
    const args = session === chatSession
      ? ["new-session", "-A", "-s", session, "-c", workspace]
      : ["attach-session", "-t", `=${session}`];
    if (session === chatSession) {
      const shell = process.env.SHELL ?? "/bin/zsh";
      args.push(`exec ${shell} -ic '${chatCommand.replace(/'/g, "'\\''")}'`);
    }
    let terminal;
    try {
      terminal = pty.spawn("tmux", args, {
        name: "xterm-256color", cols, rows, cwd: workspace,
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (error) {
      console.error("terminal spawn:", error?.message ?? error);
      socket.close(1011, "terminal could not start");
      return;
    }
    let clientClosed = false;
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    terminal.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > MAX_TERMINAL_BUFFER_BYTES) {
        socket.close(1013, "terminal client is too slow");
        return;
      }
      try { socket.send(data); } catch {}
    });
    terminal.onExit(() => {
      if (!clientClosed && socket.readyState < WebSocket.CLOSING) socket.close(4404, "tmux session ended");
    });
    socket.on("message", (raw) => {
      const text = raw.toString();
      if (text.startsWith("\x00resize:")) {
        const [nextCols, nextRows] = text.slice(8).split("x").map(Number);
        terminal.resize(dimension(nextCols, cols, 20, 500), dimension(nextRows, rows, 5, 200));
      } else {
        terminal.write(text);
      }
    });
    socket.on("error", (error) => console.error("terminal socket:", error?.message ?? error));
    socket.on("close", () => {
      clientClosed = true;
      try { terminal.kill(); } catch {}
    });
  });
  wss.on("error", (error) => console.error("terminal transport:", error?.message ?? error));
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 15_000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}
