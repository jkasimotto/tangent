/** Creates one stable Brain pane with its own terminal presentation owner. */
export function createAreaBrainPane({
  area,
  terminalController,
  projection,
  escapeHtml,
  onToggleMap,
  onHideBrain,
  onLeave,
  onResume,
  onSeedStart,
}) {
  return {
    id: "brain",
    label: "Brain",
    minSizePx: 420,
    /** Mounts one stable Brain presentation in the split-owned root. */
    mount({ host }) {
      let mode = "";
      let disposed = false;
      host.classList.add("area-workspace-brain-pane", "map-brain-pane");
      host.dataset.mapBrainPane = "";

      /** Reconciles lifecycle words without replacing a matching live terminal. */
      function update(snapshot = {}) {
        if (disposed) return;
        const facts = projection();
        const nextMode = facts.presentation.kind === "terminal" ? `live:${facts.presentation.session}` : facts.presentation.kind;
        const mapOpen = Boolean(snapshot.layout?.open?.has?.("map"));
        const mapVisible = mapOpen && (snapshot.layout?.presentation?.kind === "wide" || snapshot.layout?.presentation?.active === "map");
        const primaryBrain = snapshot.layout?.primary === "brain";
        if (mode === nextMode) {
          const title = host.querySelector(":scope > header strong");
          if (title) title.textContent = facts.label;
          const map = host.querySelector("[data-toggle-workspace-map]");
          if (map) map.textContent = mapVisible ? "Hide Map" : "Map";
          const hide = host.querySelector("[data-hide-workspace-brain]");
          if (hide) hide.hidden = primaryBrain;
          return;
        }
        terminalController.disposeTerminal();
        mode = nextMode;
        host.dataset.mode = mode;
        host.innerHTML = `<header><button type="button" data-leave-area-workspace>Work <kbd>⌘⇧↵</kbd></button><strong>${escapeHtml(facts.label)}</strong>${facts.live ? `<button class="session-tag" type="button" data-copy-session-tag="${escapeHtml(facts.live.name)}"><code>${escapeHtml(facts.live.name)}</code></button>` : ""}<button type="button" data-toggle-workspace-map>${mapVisible ? "Hide Map" : "Map"}</button><button type="button" data-hide-workspace-brain${primaryBrain ? " hidden" : ""}>Hide Brain <kbd>b</kbd></button></header><div class="map-brain-content"></div>`;
        const content = host.querySelector(".map-brain-content");
        host.querySelector("[data-toggle-workspace-map]")?.addEventListener("click", onToggleMap);
        host.querySelector("[data-hide-workspace-brain]")?.addEventListener("click", onHideBrain);
        host.querySelector("[data-leave-area-workspace]")?.addEventListener("click", onLeave);
        if (facts.presentation.kind === "terminal") {
          content.innerHTML = `<div class="terminal-host map-brain-terminal" data-session="${escapeHtml(facts.live.name)}"></div>`;
          terminalController.mountTerminal(content.firstElementChild, facts.live.name);
        } else if (facts.presentation.kind === "resuming") {
          content.innerHTML = '<p class="map-brain-state">Resuming brain…</p>';
          void onResume(area, host.querySelector("[data-toggle-workspace-map]"));
        } else {
          onSeedStart(area);
          content.innerHTML = `<div class="map-brain-start"><p>${escapeHtml(facts.label)}</p>${facts.launchHtml()}</div>`;
        }
      }
      update();
      return {
        id: "brain",
        update,
        /** Returns focus to xterm or the first stopped-Brain control. */
        focus() {
          if (host.dataset.mode?.startsWith("live:")) terminalController.focus();
          else (host.querySelector("input, textarea, select, button") ?? host).focus?.({ preventScroll: true });
        },
        /** Fits a visible terminal without measuring a hidden host. */
        fit() {
          if (!host.hidden && host.clientWidth > 0) terminalController.fit();
        },
        /** Releases only this browser terminal, never the tmux Brain. */
        dispose() {
          if (disposed) return;
          disposed = true;
          terminalController.disposeTerminal();
        },
      };
    },
  };
}

export default { createAreaBrainPane };
