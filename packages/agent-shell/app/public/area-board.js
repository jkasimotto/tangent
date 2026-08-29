import boardCore from "./area-board-core.js";
import factResolver from "./area-fact-resolver.js";
import draftStore from "./area-board-draft-store.js";
import boardSave from "./area-board-save.js";
import { escapeHtml } from "./text-format.js";

const nodeLabel = (item) => item.fact?.title || item.node.label || item.node.text || item.node.url || item.node.file || item.node.id;

function mount(host, { area, payload, documents, api, onOpenDocument, onSelectArea, narrow = false }) {
  host.replaceChildren();
  const canvas = structuredClone(payload.canvas);
  let current = canvas; let selected = null; const drafts = draftStore.create(localStorage);
  const saver = boardSave.create({ area, drafts, post: (next, baseHash) => api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area, baseHash, canvas: next, operationId: crypto.randomUUID() }) }), onState: ({ state }) => { status.textContent = state === "dirty" ? "Saving…" : state === "saved" ? "Saved" : "Save stopped. Reload or recover the draft."; } });
  saver.start(payload.hash);
  const toolbar = document.createElement("div"); toolbar.className = "area-board-toolbar";
  toolbar.innerHTML = `<strong>Living map</strong><button type="button" data-board-add-text ${narrow ? "disabled" : ""}>Text</button><button type="button" data-board-add-frame ${narrow ? "disabled" : ""}>Frame</button><button type="button" data-board-zoom-out aria-label="Zoom out">−</button><button type="button" data-board-zoom-in aria-label="Zoom in">+</button><span class="area-board-status" role="status">${narrow ? "Read-only at this width" : "Saved"}</span>`;
  const status = toolbar.querySelector(".area-board-status"); const viewport = document.createElement("div"); viewport.className = "area-board-viewport"; viewport.tabIndex = 0; viewport.setAttribute("role", "application"); viewport.setAttribute("aria-label", `Living map for ${area}`);
  const surface = document.createElement("div"); surface.className = "area-board-surface"; viewport.append(surface); host.append(toolbar, viewport);
  let zoom = 1;
  function render() {
    const resolved = factResolver.resolveCanvas(current, documents); surface.style.transform = `scale(${zoom})`; surface.replaceChildren();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("area-board-edges"); svg.setAttribute("aria-hidden", "true");
    for (const edge of current.edges) { const from = current.nodes.find((node) => node.id === edge.fromNode); const to = current.nodes.find((node) => node.id === edge.toNode); if (!from || !to) continue; const a = boardCore.center(from); const b = boardCore.center(to); svg.insertAdjacentHTML("beforeend", `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${edge.toEnd === "arrow" ? 'marker-end="url(#area-board-arrow)"' : ""}></line>`); }
    surface.append(svg);
    for (const item of resolved) {
      const node = item.node; const element = document.createElement(node.type === "group" ? "section" : "button"); element.className = `area-board-node ${node.type} ${item.fact?.ghost ? "ghost" : ""} ${selected === node.id ? "selected" : ""}`; element.dataset.boardNode = node.id; element.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px`;
      element.setAttribute("aria-label", `${item.fact?.kind || node.type}: ${nodeLabel(item)}${item.fact?.ghost ? ", missing reference" : ""}`); element.innerHTML = node.type === "group" ? `<h4>${escapeHtml(node.label || "Frame")}</h4>` : `<span>${escapeHtml(nodeLabel(item))}</span>${item.fact?.status ? `<small>${escapeHtml(item.fact.status)}</small>` : ""}`; surface.append(element);
    }
  }
  function edit(next) { current = next; saver.edit(current); render(); }
  toolbar.addEventListener("click", (event) => { if (event.target.closest("[data-board-zoom-in]")) { zoom = Math.min(2, zoom + .1); render(); } if (event.target.closest("[data-board-zoom-out]")) { zoom = Math.max(.25, zoom - .1); render(); } if (!narrow && event.target.closest("[data-board-add-text]")) edit(boardCore.addNode(current, { id: crypto.randomUUID(), type: "text", text: "New text", x: 40, y: 40, width: 220, height: 100 })); if (!narrow && event.target.closest("[data-board-add-frame]")) edit(boardCore.addNode(current, { id: crypto.randomUUID(), type: "group", label: "Frame", x: 20, y: 20, width: 500, height: 320 })); });
  viewport.addEventListener("dblclick", (event) => { const node = current.nodes.find((item) => item.id === event.target.closest("[data-board-node]")?.dataset.boardNode); if (node?.type === "file") { const areaTarget = node.file.replace(/\/[^/]+\.md$/, ""); if (node.file.endsWith(`/${areaTarget.split("/").pop()}.md`)) onSelectArea(areaTarget); else onOpenDocument(node.file); } });
  viewport.addEventListener("keydown", (event) => { if (!narrow && event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); edit(boardCore.addNode(current, { id: crypto.randomUUID(), type: "text", text: "New text", x: 40, y: 40, width: 220, height: 100 })); return; } const direction = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key]; if (!direction) return; event.preventDefault(); selected = (boardCore.directionalNode(current.nodes.filter((node) => node.type !== "group"), selected, direction) || boardCore.spatialOrder(current.nodes.filter((node) => node.type !== "group"))[0])?.id ?? null; render(); if (selected) surface.querySelector(`[data-board-node="${CSS.escape(selected)}"]`)?.focus(); });
  let drag = null;
  viewport.addEventListener("pointerdown", (event) => { if (narrow) return; const element = event.target.closest("[data-board-node]"); const node = current.nodes.find((item) => item.id === element?.dataset.boardNode); if (!node) return; selected = node.id; drag = { id: node.id, x: event.clientX, y: event.clientY, left: node.x, top: node.y }; element.setPointerCapture(event.pointerId); render(); });
  viewport.addEventListener("pointermove", (event) => { if (!drag) return; current = boardCore.updateNode(current, drag.id, { x: drag.left + (event.clientX - drag.x) / zoom, y: drag.top + (event.clientY - drag.y) / zoom }); render(); });
  viewport.addEventListener("pointerup", () => { if (!drag) return; drag = null; saver.edit(current); });
  render(); return { current: () => current, flush: saver.flush };
}

export default { mount };
