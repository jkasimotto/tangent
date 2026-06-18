export interface LaunchConfig {
  driver: string | { type: "custom"; template: string };
  tmux: boolean;
  agentCommand: string;
}

export interface LaunchSession {
  cwd: string;
  kind: "agent" | "terminal";
  tmux: boolean;
  tmuxSession?: string;
  title?: string;
  iterm2SessionId?: string;
  startedAt: string;
}

export type LauncherClient = {
  loadConfig(): Promise<LaunchConfig>;
  saveConfig(config: LaunchConfig): Promise<void>;
  listSessions(): Promise<LaunchSession[]>;
  openAgent(path: string, options?: { tmux?: boolean; title?: string }): Promise<void>;
  openTerminal(path: string, options?: { title?: string }): Promise<void>;
  stopSession(session: LaunchSession): Promise<void>;
  focusSession(session: LaunchSession): Promise<void>;
};

/** Creates a browser client backed by the local launcher HTTP API. */
export function createLauncherApiClient(basePath = "/api/launcher"): LauncherClient {
  return {
    /** Fetches the current launcher config from the API. */
    async loadConfig() {
      const response = await fetch(`${basePath}/config`);
      if (!response.ok) throw new Error(`Launcher API unavailable (${response.status}).`);
      return response.json() as Promise<LaunchConfig>;
    },
    /** Saves updated launcher config via the API. */
    async saveConfig(config) {
      const response = await fetch(`${basePath}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config)
      });
      if (!response.ok) throw new Error(`Launcher API error (${response.status}).`);
    },
    /** Returns active sessions from the API; returns empty array on error. */
    async listSessions() {
      const response = await fetch(`${basePath}/sessions`);
      if (!response.ok) return [];
      const value = await response.json() as unknown;
      return Array.isArray(value) ? (value as LaunchSession[]) : [];
    },
    /** Opens an agent session in the given path, optionally overriding tmux. */
    async openAgent(path, options) {
      const response = await fetch(`${basePath}/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "agent", path, tmux: options?.tmux, title: options?.title })
      });
      if (!response.ok) throw new Error(`Launcher API error (${response.status}).`);
    },
    /** Opens a plain terminal in the given path. */
    async openTerminal(path, options) {
      const response = await fetch(`${basePath}/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "terminal", path, title: options?.title })
      });
      if (!response.ok) throw new Error(`Launcher API error (${response.status}).`);
    },
    /** Stops a running session by killing the tmux session or closing the iTerm2 tab. */
    async stopSession(session) {
      const response = await fetch(`${basePath}/sessions/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(session)
      });
      if (!response.ok) throw new Error(`Launcher API error (${response.status}).`);
    },
    /** Focuses a running session by bringing the iTerm2 tab to front or attaching to the tmux session. */
    async focusSession(session) {
      const response = await fetch(`${basePath}/sessions/focus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(session)
      });
      if (!response.ok) throw new Error(`Launcher API error (${response.status}).`);
    }
  };
}
