import { escapeHtml } from "./text-format.js";

/** Renders the shared single-choice Person menu. */
export function personMenu({ id, options, selected = "all", label = "Person" }) {
  const active = options.find(([value]) => value === selected) ?? options[0] ?? ["all", "All"];
  const menuId = `${id}-menu`;
  return `<div class="person-menu" data-person-menu>
    <button id="${escapeHtml(id)}" class="person-menu-button" type="button" data-person-menu-button aria-label="${escapeHtml(`${label}: ${active[1]}`)}" title="${escapeHtml(`${label}: ${active[1]}`)}" aria-haspopup="menu" aria-expanded="false" aria-controls="${escapeHtml(menuId)}"><span>Person</span><strong>${escapeHtml(active[1])}</strong><b aria-hidden="true">⌄</b></button>
    <div id="${escapeHtml(menuId)}" class="person-menu-popover" role="menu" aria-label="${escapeHtml(label)}" hidden>
      ${options.map(([value, text]) => `<button type="button" role="menuitemradio" data-person-value="${escapeHtml(value)}" aria-checked="${value === active[0]}" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}"><span>${escapeHtml(text)}</span><b aria-hidden="true">${value === active[0] ? "✓" : ""}</b></button>`).join("")}
    </div>
  </div>`;
}

export default { personMenu };
