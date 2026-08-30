import { goalStopTarget } from "./goal-stop.mjs";

/** Creates the Goal Stop operation that delegates to the shared exact-session stop. */
export function createGoalStopOperation({ listSessions, stopSession }) {
  return async function stopGoal({ goal, expectedSession, expectedTarget } = {}) {
    const target = goalStopTarget(await listSessions({ fresh: true }), { goal, expectedSession, expectedTarget });
    if (target.status !== 200) return target;
    return stopSession(target.name, target.target);
  };
}
