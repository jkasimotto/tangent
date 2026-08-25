import { escapeHtml } from "./text-format.js";

/** Creates the agent decision view product boundary. */
export function createAgentDecisionView({ state, agentName, areaLabel, currentBriefFields, storyEntries }) {
  /** Renders explicit run and goal decisions after an agent returns. */
  function renderDecision(goal, session) {
    const name = agentName(session);
    const reference = agentReference(name);
    return `
      <article class="decision-page">
        <p class="kicker">${escapeHtml(areaLabel(goal.area))}</p>
        <h1>What happens next?</h1>
        <p>Choose one result for this run.</p>
        <div class="decision-options">
          <button class="decision-option" type="button" data-keep-working><strong>Keep working with ${escapeHtml(reference)}</strong><span>Return to the agent and type your next message.</span></button>
          <button class="decision-option" type="button" data-finish-run><strong>End this agent run</strong><span>The session ends. The work and its progress note stay open.</span></button>
          <button class="decision-option" type="button" data-mark-complete><strong>The complete work is done</strong><span>The work closes only after you approve a confirmation.</span></button>
          <button class="decision-option" type="button" data-mark-wont-do><strong>This work won't be done</strong><span>Give a brief reason so that you can recall the decision later.</span></button>
        </div>
      </article>
    `;
  }

  /** Returns the newest open linked Goal that owns the complete Document review. */

  return { renderDecision };
}
