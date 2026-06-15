import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { EvalApp } from "@tangent/eval-ui";
import { RollupApp } from "@tangent/rollup-ui";
import { UsageApp } from "@tangent/usage-ui";

const meta: Meta = { title: "Product/UsageSessionDetail" };
export default meta;

export const UsageSessionDetail: StoryObj = {
  name: "Product/UsageSessionDetail",
  /** Renders the Storybook example. */
  render: () => <UsageApp />
};

export const EvalCompare: StoryObj = {
  name: "Product/EvalCompare",
  /** Renders the Storybook example. */
  render: () => <EvalApp />
};

export const RollupBuilder: StoryObj = {
  name: "Product/RollupBuilder",
  /** Renders the Storybook example. */
  render: () => <RollupApp />
};
