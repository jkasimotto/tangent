  function create({ area, post, drafts, delay = 2_000, setTimer = setTimeout, clearTimer = clearTimeout, onState = () => {} }) {
    let timer = null; let pending = null; let active = null; let stopped = false; let baseHash = null;
    async function flush() {
      if (active || !pending || stopped) return active;
      const canvas = pending; pending = null;
      active = post(canvas, baseHash).then((result) => {
        if (result?.status === 409 || result?.status === 503 || result?.error) { stopped = true; onState({ state: "blocked", result }); return result; }
        baseHash = result.hash; drafts.clear(area); onState({ state: "saved", result }); return result;
      }).finally(() => { active = null; if (pending && !stopped) flush(); });
      return active;
    }
    function edit(canvas) {
      pending = structuredClone(canvas); drafts.save(area, { baseHash, canvas: pending }); onState({ state: "dirty" });
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; flush(); }, delay);
    }
    function start(hash) { baseHash = hash; stopped = false; }
    return { edit, flush, start, get stopped() { return stopped; } };
  }
export { create };
export default { create };
