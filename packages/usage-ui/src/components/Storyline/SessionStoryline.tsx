import React from "react";
import type { UsageStorylineView } from "@tangent/usage-ui-data";
import { StoryChapterCard } from "./StoryChapterCard.js";

/** Renders the SessionStoryline UI. */
export function SessionStoryline({ storyline }: { storyline: UsageStorylineView }): React.ReactElement {
  return (
    <section className="usage-section usage-storyline" aria-labelledby="usage-storyline-title">
      <header className="usage-section__header">
        <h2 id="usage-storyline-title">What happened</h2>
      </header>
      <div className="usage-storyline__chapters">
        {storyline.chapters.map((chapter, index) => <StoryChapterCard key={chapter.id} chapter={chapter} index={index} />)}
      </div>
    </section>
  );
}
