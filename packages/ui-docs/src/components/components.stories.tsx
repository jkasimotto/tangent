import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CaveatList, ConfidenceBadge, MetricCard, MetricDelta, StatusPill } from "@tangent/ui-components";

const meta: Meta = { title: "Components/MetricCard" };
export default meta;

export const MetricCardStory: StoryObj = {
  name: "Components/MetricCard",
  /** Renders the Storybook example. */
  render: () => <MetricCard label="Tokens" value={104000} unit="tokens" confidence="exact" caveatCount={1} />
};

export const MetricDeltaStory: StoryObj = {
  name: "Components/MetricDelta",
  /** Renders the Storybook example. */
  render: () => <MetricDelta label="Wall time" leftLabel="A" rightLabel="B" left={1200} right={900} unit="ms" polarity="lower-is-better" />
};

export const StatusPillStory: StoryObj = {
  name: "Components/StatusPill",
  /** Renders the Storybook example. */
  render: () => <StatusPill status="done" />
};

export const CaveatListStory: StoryObj = {
  name: "Components/CaveatList",
  /** Renders the Storybook example. */
  render: () => <CaveatList caveats={["Token usage is estimated."]} />
};

export const ConfidenceBadgeStory: StoryObj = {
  name: "Components/ConfidenceBadge",
  /** Renders the Storybook example. */
  render: () => <ConfidenceBadge confidence="partial" />
};
