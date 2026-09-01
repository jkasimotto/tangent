/** Reconciles generated HTML while retaining matching keyed elements. */
export function reconcileHtml(root, html) {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  reconcileChildren(root, template.content);
}
/** Reconciles one parent's children in their requested order. */
function reconcileChildren(currentParent, wantedParent) {
  const wanted = [...wantedParent.childNodes];
  let cursor = currentParent.firstChild;
  for (const next of wanted) {
    let current = cursor;
    if (!compatible(current, next)) {
      const keyed = nodeKey(next);
      current = keyed ? [...currentParent.childNodes].find((node) => nodeKey(node) === keyed && compatibleType(node, next)) : null;
      if (current) currentParent.insertBefore(current, cursor);
      else current = currentParent.insertBefore(next.cloneNode(true), cursor);
    }
    reconcileNode(current, next);
    cursor = current.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

/** Reconciles one compatible node. */
function reconcileNode(current, wanted) {
  if (current.nodeType === 3 || current.nodeType === 8) {
    if (current.nodeValue !== wanted.nodeValue) current.nodeValue = wanted.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) if (!wanted.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of [...wanted.attributes]) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  reconcileChildren(current, wanted);
}

/** Returns a stable identity for a generated Work element. */
function nodeKey(node) {
  if (node?.nodeType !== 1) return "";
  const value = node.id || node.getAttribute("data-work-cursor") || node.getAttribute("data-work-group") || "";
  return value ? `${node.tagName}:${value}` : "";
}

/** Returns true when two nodes can be reconciled in place. */
function compatible(current, wanted) {
  if (!compatibleType(current, wanted)) return false;
  const wantedKey = nodeKey(wanted);
  return !wantedKey || nodeKey(current) === wantedKey;
}

/** Returns true when two nodes have the same DOM type and element name. */
function compatibleType(current, wanted) {
  return Boolean(current) && current.nodeType === wanted.nodeType && (current.nodeType !== 1 || current.tagName === wanted.tagName);
}
