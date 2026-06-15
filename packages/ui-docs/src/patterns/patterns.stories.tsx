import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CompareLayout, MasterDetailLayout, RollupBuilderLayout, TranscriptLayout } from "@tangent/ui-patterns";

const meta: Meta = { title: "Patterns/MasterDetailLayout" };
export default meta;

export const MasterDetailLayoutStory: StoryObj = {
  name: "Patterns/MasterDetailLayout",
  /** Renders the Storybook example. */
  render: () => <MasterDetailLayout list="List" detail="Detail" inspector="Inspector" />
};

export const CompareLayoutStory: StoryObj = {
  name: "Patterns/CompareLayout",
  /** Renders the Storybook example. */
  render: () => <CompareLayout controls="Controls" left="Left" right="Right" tabs="Tabs" />
};

export const TranscriptLayoutStory: StoryObj = {
  name: "Patterns/TranscriptLayout",
  /** Renders the Storybook example. */
  render: () => <TranscriptLayout rail="1" messages="Messages" evidence="Evidence" />
};

export const RollupBuilderLayoutStory: StoryObj = {
  name: "Patterns/RollupBuilderLayout",
  /** Renders the Storybook example. */
  render: () => <RollupBuilderLayout steps="Steps" preview="Preview" output="Output" />
};
