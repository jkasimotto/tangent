// Pane write serialization: one queue per tmux session, so two writers can
// never type into the same pane at once. Pure module, no tmux, no HTTP.
//
// Why it exists: the server has two independent writers into a brain's pane.
// A brain generation is armed with its activation prompt while its pane still
// sits at the shell (armSession in server.mjs), and the arming poll types that
// prompt as soon as the harness comes up. The message queue types worker
// reports and other notices into the same pane. Delivery used to need an idle
// agent, and the boot wait watched for a quiet screen, so the two writers
// could not overlap by accident. Mid-turn delivery removed both of those
// accidents: a booting harness reads as working with an empty composer, so a
// notice could be typed into the middle of the activation prompt and both
// texts would arrive as one corrupted line.
//
// `run` puts every write for one pane behind the write before it. `busy` says
// whether a pane already has a write queued or running, which is the fact the
// delivery decision needs to hold a notice back instead of racing for it.

/** Owns one write queue per pane. */
export function createPaneWriteQueue() {
  const tails = new Map();
  const depth = new Map();

  /**
   * Runs one write after every write already queued for the same pane, and
   * resolves with what the write returned. A write that throws does not stop
   * the writes behind it: the pane is still there and the next writer still
   * checks it for itself.
   */
  function run(session, write) {
    depth.set(session, (depth.get(session) ?? 0) + 1);
    const previous = tails.get(session) ?? Promise.resolve();
    /** Starts this write whatever the write before it did. */
    const start = () => write();
    const started = previous.then(start, start);
    /** Drops this write from the pane's depth once it settles, either way. */
    const done = () => {
      const left = (depth.get(session) ?? 1) - 1;
      if (left > 0) {
        depth.set(session, left);
        return;
      }
      depth.delete(session);
      if (tails.get(session) === tail) tails.delete(session);
    };
    const tail = started.then(done, done);
    tails.set(session, tail);
    return started;
  }

  /** True while a write into this pane is queued or running. */
  function busy(session) {
    return (depth.get(session) ?? 0) > 0;
  }

  return { busy, run };
}
