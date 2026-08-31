import { goalStopTarget } from "./goal-stop.mjs";

/** Creates the Goal Stop operation that delegates to the shared exact-session stop. */
export function createGoalStopOperation({ listSessions, stopSession, receipts = null, recordStage = () => {} }) {
  const completed = new Map();
  return async function stopGoal({ goal, expectedSession, expectedTarget, operationId } = {}) {
    const startedAt = performance.now();
    if (!operationId) return { status: 400, code: "operation-required", error: "an operation ID is required" };
    const durable = await receipts?.read(operationId);
    const prior = completed.get(operationId) ?? (durable?.state === "complete" ? durable.result : null);
    if (prior) return prior;
    if (durable && (durable.goal !== goal || durable.expectedSession !== expectedSession || durable.expectedTarget !== expectedTarget)) {
      return { status: 409, code: "operation-conflict", error: `stop operation ${operationId} names different inputs` };
    }
    const target = durable
      ? { status: 200, name: durable.expectedSession, target: durable.expectedTarget }
      : goalStopTarget(await listSessions({ fresh: true }), { goal, expectedSession, expectedTarget });
    recordStage("target-lookup", operationId, startedAt, target.status === 200 ? "ok" : "rejected");
    if (target.status !== 200) return target;
    if (!durable) await receipts?.write({ schema: "goal-stop-operation.v1", operationId, goal, expectedSession: target.name, expectedTarget: target.target, state: "pending", requestedAt: new Date().toISOString() });
    const stopped = await stopSession(target.name, target.target);
    recordStage("process-settled", operationId, startedAt, stopped.status === 200 ? "committed" : "rejected");
    if (stopped.status !== 200) return stopped;
    const result = { status: 200, value: {
      operationId, target: { kind: "goal", id: goal, tmuxTarget: target.target }, state: "committed",
      effect: { sessionState: "absent", queueFinal: Boolean(stopped.value?.pipelineEnded) }, retryable: false,
      ...stopped.value,
    } };
    completed.set(operationId, result);
    await receipts?.write({ schema: "goal-stop-operation.v1", operationId, goal, expectedSession: target.name, expectedTarget: target.target, state: "complete", completedAt: new Date().toISOString(), result });
    return result;
  };
}
