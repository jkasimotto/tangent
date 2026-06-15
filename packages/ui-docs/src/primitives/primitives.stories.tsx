import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button, Dialog, Tabs } from "@tangent/ui-primitives";

const meta: Meta = { title: "Primitives/Button" };
export default meta;

export const ButtonStory: StoryObj = {
  name: "Primitives/Button",
  /** Renders the Storybook example. */
  render: () => <Button variant="primary">Open transcript</Button>
};

export const DialogStory: StoryObj = {
  name: "Primitives/Dialog",
  /** Renders the Storybook example. */
  render: () => <Dialog title="Confirm action" trigger={<Button>Open dialog</Button>}><p>Dialog content</p></Dialog>
};

export const TabsStory: StoryObj = {
  name: "Primitives/Tabs",
  /** Renders the Storybook example. */
  render: () => <Tabs tabs={[{ id: "one", label: "One", panel: "First" }, { id: "two", label: "Two", panel: "Second" }]} />
};

export const DataGridStory: StoryObj = {
  name: "Primitives/DataGrid",
  /** Renders the Storybook example. */
  render: () => <div role="grid" className="tg-data-grid"><div role="row">Row</div></div>
};
