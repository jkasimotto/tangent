import React from "react";
import type { SessionFinderItem as SessionFinderItemView } from "@tangent/usage-ui-data";

/** Renders the SessionFinderItem UI. */
export function SessionFinderItem({
  item,
  selected,
  onSelect
}: {
  item: SessionFinderItemView;
  selected: boolean;
  onSelect(id: string): void;
}): React.ReactElement {
  const meta = [
    item.provider,
    item.durationLabel,
    item.tokenLabel ? `${item.tokenLabel} tok` : undefined,
    item.toolCallCount === undefined ? undefined : `${item.toolCallCount} tools`,
    item.fileCount === undefined ? undefined : `${item.fileCount} files`
  ].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className="usage-finder-item"
      data-selected={selected || undefined}
      data-status={item.status}
      onClick={() => onSelect(item.id)}
    >
      <span className="usage-finder-item__state" aria-hidden="true" />
      <span className="usage-finder-item__title">{item.title}</span>
      <span className="usage-finder-item__meta">{meta}</span>
      <span className="usage-finder-item__footer">
        <span>{item.lastActivityLabel}</span>
        {item.caveatCount ? <span>{item.caveatCount} caveats</span> : null}
      </span>
    </button>
  );
}
