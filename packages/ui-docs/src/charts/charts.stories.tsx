import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MetricBarChart, TimelineBarChart } from "@tangent/ui-charts";

const meta: Meta = { title: "Charts/TimelineBarChart" };
export default meta;

export const TimelineBarChartStory: StoryObj = {
  name: "Charts/TimelineBarChart",
  /** Renders the Storybook example. */
  render: () => <TimelineBarChart metric="durationMs" items={[{ id: "1", label: "Prompt", kind: "message", durationMs: 200 }, { id: "2", label: "Tool", kind: "tool", durationMs: 700 }]} />
};

export const MetricBarChartStory: StoryObj = {
  name: "Charts/MetricBarChart",
  /** Renders the Storybook example. */
  render: () => <MetricBarChart values={[{ label: "A", value: 10 }, { label: "B", value: 18 }]} />
};
