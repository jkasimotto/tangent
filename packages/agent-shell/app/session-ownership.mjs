import { createHash } from "node:crypto";
import path from "node:path";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

export const SESSION_OWNER_SCHEMA = "agent-shell-session-owner.v1";
export const SESSION_OWNER_OPTION = "@tangent_agent_shell_instance";

/** Returns one stable Agent Shell identity for an explicit public endpoint. */
export function agentShellInstanceId({ explicit = "", host, port, treesRoot, chatSession }) {
  const supplied = String(explicit ?? "").trim();
  if (supplied) {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(supplied)) {
      throw new Error("TANGENT_SHELL_INSTANCE_ID must use 1 to 128 letters, digits, dots, colons, underscores, or hyphens.");
    }
    return supplied;
  }
  const seed = [String(host), String(port), path.resolve(String(treesRoot)), String(chatSession)].join("\0");
  return `agent-shell-${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

/** Returns the sidecar path for one session without trusting its tmux name as a path. */
export function sessionOwnerPath(root, session) {
  const key = createHash("sha256").update(String(session)).digest("hex");
  return path.join(root, `${key}.json`);
}

/** Reads the last Agent Shell instance that created one session name. */
export async function readSessionOwner(root, session) {
  const record = await readJsonObject(sessionOwnerPath(root, session));
  if (!record || record.schema !== SESSION_OWNER_SCHEMA || record.session !== session || !record.instanceId) return null;
  return record;
}

/** Creates the tmux and durable ownership boundary for one Agent Shell instance. */
export function createSessionOwnership({ instanceId, root, runTmux, now = () => new Date().toISOString() }) {
  if (!instanceId) throw new Error("Agent Shell session ownership needs an instance ID.");

  /** Records ownership on the immutable tmux target returned by session creation. */
  async function claim(session, target = session) {
    await runTmux(["set-option", "-t", target, SESSION_OWNER_OPTION, instanceId]);
    const record = { schema: SESSION_OWNER_SCHEMA, session, instanceId, claimedAt: now() };
    await writeJsonObject(sessionOwnerPath(root, session), record);
    return record;
  }

  /** Reads the live owner marker without treating a tmux error as absence. */
  async function inspect(session) {
    try {
      await runTmux(["has-session", "-t", `=${session}`]);
      const result = await runTmux(["display-message", "-p", "-t", `=${session}:`, `#{session_id}\t#{${SESSION_OWNER_OPTION}}`]);
      const [target, owner = ""] = String(result.stdout ?? "").trimEnd().split("\t");
      if (!target) return { state: "error", instanceId: null, error: new Error(`tmux returned no session ID for ${session}`) };
      return { state: "live", instanceId: owner.trim() || null, target };
    } catch (error) {
      const detail = `${error?.stderr ?? ""} ${error?.message ?? ""}`.toLowerCase();
      if (detail.includes("can't find session") || detail.includes("can't find pane") || detail.includes("no server running") || detail.includes("failed to connect to server") || detail.includes("no such file")) {
        return { state: "absent", instanceId: null };
      }
      return { state: "error", instanceId: null, error };
    }
  }

  /** True when a vanished session's durable marker belongs to this instance. */
  async function ownsRecorded(session) {
    return (await readSessionOwner(root, session))?.instanceId === instanceId;
  }

  /** Claims one exact pre-marker brain after its durable and live identities match. */
  async function claimLegacyBrain({ session, area, generation }) {
    const inspected = await inspect(session);
    if (inspected.state !== "live") return inspected;
    if (inspected.instanceId) {
      return inspected.instanceId === instanceId
        ? { state: "owned", instanceId, target: inspected.target }
        : { state: "foreign", instanceId: inspected.instanceId, target: inspected.target };
    }
    try {
      const result = await runTmux([
        "display-message", "-p", "-t", inspected.target,
        `#{@tangent_kind}\t#{@tangent_brain}\t#{@tangent_generation}`,
      ]);
      const [kind = "", liveArea = "", liveGeneration = ""] = String(result.stdout ?? "").trimEnd().split("\t");
      if (kind !== "brain" || liveArea !== area || liveGeneration !== String(generation)) {
        return { state: "mismatch", instanceId: null, target: inspected.target, kind, area: liveArea, generation: liveGeneration };
      }
      await runTmux(["set-option", "-o", "-t", inspected.target, SESSION_OWNER_OPTION, instanceId]);
    } catch (error) {
      const after = await inspect(session);
      if (after.state === "live" && after.instanceId) {
        return after.instanceId === instanceId
          ? { state: "owned", instanceId, target: after.target }
          : { state: "foreign", instanceId: after.instanceId, target: after.target };
      }
      return { state: "error", instanceId: null, error };
    }
    const after = await inspect(session);
    if (after.state !== "live" || after.instanceId !== instanceId) {
      if (after.state === "live" && after.instanceId) return { state: "foreign", instanceId: after.instanceId, target: after.target };
      return { state: "error", instanceId: after.instanceId ?? null, error: new Error(`tmux did not retain ownership for ${session}`) };
    }
    const record = { schema: SESSION_OWNER_SCHEMA, session, instanceId, claimedAt: now() };
    await writeJsonObject(sessionOwnerPath(root, session), record);
    return { state: "claimed", instanceId, target: after.target };
  }

  /** Terminates one live session only after its tmux marker proves ownership. */
  async function terminate(session) {
    const inspected = await inspect(session);
    if (inspected.state !== "live") return inspected;
    if (!inspected.instanceId) return { state: "legacy", instanceId: null };
    if (inspected.instanceId !== instanceId) return { state: "foreign", instanceId: inspected.instanceId };
    try {
      await runTmux(["kill-session", "-t", inspected.target]);
      return { state: "terminated", instanceId };
    } catch (error) {
      return { state: "error", instanceId, error };
    }
  }

  return { instanceId, claim, claimLegacyBrain, inspect, ownsRecorded, terminate };
}
