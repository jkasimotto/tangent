import areaMapCore from "./public/area-map-core.js";
import { goalIsHiddenByDefault } from "./goal-lifecycle.mjs";

/** Builds the server-owned Area panel and Goal-attention projection. */
export function projectDesk(vault, sessions) {
  const areas = vault?.areas ?? vault?.map ?? [];
  const goals = areas.flatMap((area) => area.goals ?? []);
  const sessionsByGoal = new Map(sessions.filter((session) => session.goal).map((session) => [session.goal, session]));
  const descriptions = sessions.filter((session) => session.kind === "work-definition" && session.area);
  const attention = Object.fromEntries(goals.map((goal) => [goal.file, goalAttention(goal, sessionsByGoal.get(goal.file))]));
  const openCounts = new Map(areas.map((area) => {
    const open = (area.goals ?? []).filter((goal) => !goalIsHiddenByDefault(goal.status)).length;
    const describing = descriptions.some((session) => session.area === area.path);
    return [area.path, Math.max(open, describing ? 1 : 0)];
  }));
  // The server projection lists Areas with open work only. The browser desk
  // gives every not-done Area a row on its own (work-desk-view deskAreas).
  const withWork = new Map([...openCounts].filter(([, count]) => count > 0));
  const definitions = areaMapCore.deskPanels(withWork);
  const covered = new Set(definitions.flatMap((panel) => [panel.path, ...panel.sections]));
  for (const area of areas) {
    if (covered.has(area.path) || !(area.documents ?? []).length) continue;
    if (definitions.some((panel) => areaMapCore.isInside(area.path, panel.path))) continue;
    definitions.push({ path: area.path, sections: [] });
  }
  const byPath = new Map(areas.map((area) => [area.path, area]));
  const panels = areaMapCore.orderPanels(definitions, (panel) => panelActivity(panel, byPath, sessions));
  return { attention, panels };
}

/** Returns the desk attention word for one Goal. */
function goalAttention(goal, session) {
  if (goal.waitingOn || ["waiting", "shell"].includes(session?.state)) return "waiting";
  return session ? "working" : "ready";
}

/** Returns live-work and last-change facts for one panel and its sections. */
function panelActivity(panel, byPath, sessions) {
  const paths = [panel.path, ...panel.sections];
  const working = sessions.some((session) => paths.includes(session.area) && session.state === "working");
  let mtime = 0;
  for (const areaPath of paths) {
    const area = byPath.get(areaPath);
    for (const item of [...(area?.goals ?? []), ...(area?.documents ?? [])]) {
      mtime = Math.max(mtime, item.changedAt ?? item.mtime ?? 0);
    }
  }
  return { working, mtime };
}
