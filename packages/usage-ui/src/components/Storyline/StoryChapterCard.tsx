import React from "react";
import type { UsageStoryChapter } from "@tangent/usage-ui-data";
import { StorylineRail } from "./StorylineRail.js";

/** Renders the StoryChapterCard UI. */
export function StoryChapterCard({ chapter, index }: { chapter: UsageStoryChapter; index: number }): React.ReactElement {
  const meta = [
    chapter.durationLabel,
    chapter.tokenLabel ? `${chapter.tokenLabel} tok` : undefined,
    chapter.toolCallCount === undefined ? undefined : `${chapter.toolCallCount} tools`,
    chapter.fileCount === undefined ? undefined : `${chapter.fileCount} files`
  ].filter(Boolean).join(" · ");
  return (
    <article className="usage-story-chapter" data-kind={chapter.dominantKind}>
      <StorylineRail index={index} status={chapter.status} />
      <div className="usage-story-chapter__content">
        <header>
          <h3>{chapter.title}</h3>
          <span>{chapter.status}</span>
        </header>
        <p>{chapter.summary}</p>
        {meta ? <em>{meta}</em> : null}
        {chapter.steps.length ? (
          <ul>
            {chapter.steps.slice(0, 4).map((step) => <li key={step}>{step}</li>)}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
