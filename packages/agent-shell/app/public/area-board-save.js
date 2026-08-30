  /** Creates the debounced, optimistic Area-map save machine. */
  function create({ area, post, drafts, delay = 2_000, setTimer = setTimeout, clearTimer = clearTimeout, onState = () => {} }) {
    let timer = null; let pending = null; let active = null; let stopped = false; let baseHash = null; let failed = null;
    /** Saves the latest pending scene, if one exists. */
    async function flush() {
      if (active || !pending || stopped) return active;
      const canvas = pending; pending = null; onState({ state: "saving" });
      active = post(canvas, baseHash).then((result) => {
        if (result?.status === 409 || result?.status === 503 || result?.error) {
          stopped = true; failed = structuredClone(canvas); drafts.save(area, { baseHash, canvas: failed });
          onState({ state: "blocked", result }); return result;
        }
        baseHash = result.hash; failed = null; drafts.clear(area); onState({ state: "saved", result }); return result;
      }).finally(() => { active = null; if (pending && !stopped) flush(); });
      return active;
    }
    /** Records one authored edit without creating a recovery draft yet. */
    function edit(canvas) {
      pending = structuredClone(canvas); failed = null; onState({ state: "dirty" });
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; flush(); }, delay);
    }
    /** Starts or retries against one acknowledged repository hash. */
    function start(hash) { baseHash = hash; stopped = false; if (failed && !pending) pending = failed; }
    return {
      edit, flush, start,
      /** Reports whether a failed save needs a user action. */
      get stopped() { return stopped; },
    };
  }
export { create };
export default { create };
