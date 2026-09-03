/** Creates one stable Map pane around the existing Area-board controller. */
export function createAreaMapPane({
  area,
  areaBoardView,
  api,
  documents,
  getDocuments,
  searchDocuments = null,
  focus,
  onEvent,
  onEntityVerb,
  onBack,
  onNavigation,
  onViewState,
  onController = () => {},
}) {
  return {
    id: "map",
    label: "Map",
    minSizePx: 560,
    /** Mounts one stable Area-board controller in the split-owned root. */
    mount({ host }) {
      let controller = null;
      let generation = 0;
      let disposed = false;
      host.classList.add("area-workspace-map-pane", "map-column");
      host.dataset.mapColumn = "";
      const mapHost = host.ownerDocument.createElement("div");
      mapHost.className = "area-map-host dedicated-map";
      mapHost.dataset.dedicatedAreaMap = area;
      mapHost.innerHTML = "<p>Loading the complete Area map…</p>";
      host.append(mapHost);

      /** Loads one authority generation without allowing stale completion to mount. */
      async function load() {
        const ownGeneration = ++generation;
        mapHost.dataset.loaded = "loading";
        mapHost.innerHTML = "<p>Loading the complete Area map…</p>";
        try {
          const authority = await areaBoardView.loadAreaMapAuthority(api, area);
          if (disposed || ownGeneration !== generation) return;
          mapHost.dataset.loaded = authority.mode;
          controller = areaBoardView.mount(mapHost, {
            area,
            ...authority,
            documents: documents(),
            getDocuments,
            searchDocuments,
            api,
            onEvent,
            onEntityVerb,
            onBack,
            onNavigation,
            onViewState,
            locatedArea: area,
            focus: focus(),
          });
          onController(controller);
        } catch (error) {
          if (disposed || ownGeneration !== generation) return;
          mapHost.dataset.loaded = "error";
          const section = host.ownerDocument.createElement("section");
          section.className = "area-board-empty";
          section.setAttribute("role", "alert");
          const heading = host.ownerDocument.createElement("h2");
          heading.textContent = "The Area map did not load.";
          const detail = host.ownerDocument.createElement("p");
          detail.textContent = String(error?.message ?? error);
          const retry = host.ownerDocument.createElement("button");
          retry.type = "button";
          retry.textContent = "Retry";
          retry.addEventListener("click", load);
          section.append(heading, detail, retry);
          mapHost.replaceChildren(section);
        }
      }
      void load();

      return {
        id: "map",
        /** Reconciles projection facts without replacing editor state. */
        update(snapshot) {
          if (!controller) return;
          controller.refreshFacts?.(snapshot.documents, snapshot.focus);
        },
        /** Returns focus to the live editor island. */
        focus() {
          (mapHost.querySelector("canvas.interactive, button, input, textarea") ?? host).focus?.({ preventScroll: true });
        },
        /** The Area board measures itself through its existing observers. */
        fit() {},
        /** Exposes the current domain controller to workspace actions. */
        controller: () => controller,
        /** Flushes and releases this Map visit once. */
        async dispose() {
          if (disposed) return;
          disposed = true;
          generation += 1;
          onController(null);
          await controller?.destroy?.();
          controller = null;
        },
      };
    },
  };
}

export default { createAreaMapPane };
