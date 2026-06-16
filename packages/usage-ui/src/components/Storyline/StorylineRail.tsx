import React from "react";

/** Renders the StorylineRail UI. */
export function StorylineRail({ index, status }: { index: number; status: string }): React.ReactElement {
  return (
    <span className="usage-story-rail" data-status={status}>
      <span>{index + 1}</span>
    </span>
  );
}
