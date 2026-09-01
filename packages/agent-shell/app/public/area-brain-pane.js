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
      let launchMarkup = "";
      let disposed = false;
      host.classList.add("area-workspace-brain-pane", "map-brain-pane");
      host.dataset.mapBrainPane = "";

      /** Focuses the live composer or the useful action for a stopped Brain. */
      function focusDestination() {
        if (host.dataset.mode?.startsWith("live:")) return terminalController.focus();
        const content = host.querySelector(".map-brain-content");
        const primary = content?.querySelector("[data-launch-primary]:not([disabled])");
        const selected = content?.querySelector("[data-launch-column='harness'] .launch-option.selected:not([disabled])");
        const control = primary ?? selected ?? content?.querySelector("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex='0']");
        (control ?? host).focus?.({ preventScroll: true });
      }

      /** Reconciles lifecycle words without replacing a matching live terminal. */
      function update(snapshot = {}) {
        if (disposed) return;
        const active = host.ownerDocument.activeElement;
        const ownedFocus = host.contains(active);
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
          if (facts.presentation.kind === "start") {
            onSeedStart(area);
            const nextMarkup = facts.launchHtml();
            if (nextMarkup !== launchMarkup) {
              const focusKey = host.contains(active) ? active.closest?.("[data-focus-key]")?.dataset.focusKey : "";
              const content = host.querySelector(".map-brain-content");
              if (content) content.innerHTML = `<div class="map-brain-start"><p>${escapeHtml(facts.label)}</p>${nextMarkup}</div>`;
              launchMarkup = nextMarkup;
              if (focusKey) [...host.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === focusKey)?.focus?.({ preventScroll: true });
              else if (ownedFocus) focusDestination();
            }
          }
          return;
        }
        terminalController.disposeTerminal();
        mode = nextMode;
        launchMarkup = "";
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
          launchMarkup = facts.launchHtml();
          content.innerHTML = `<div class="map-brain-start"><p>${escapeHtml(facts.label)}</p>${launchMarkup}</div>`;
        }
        if (ownedFocus) focusDestination();
      }
      update();
      return {
        id: "brain",
        update,
        /** Returns focus to xterm or the first stopped-Brain control. */
        focus: focusDestination,
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
