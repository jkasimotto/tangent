import React from "react";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = { title: "Foundations/Colors" };
export default meta;

export const Colors: StoryObj = {
  /** Renders the Storybook example. */
  render: () => <div style={{ display: "grid", gap: 8 }}>{["bg", "surface", "surfaceRaised", "surfaceInset", "text", "textMuted", "border", "accent", "success", "warning", "danger", "info", "diffAdd", "diffDelete", "chart"].map((name) => <div key={name} style={{ display: "flex", gap: 8 }}><span style={{ background: `var(--tangent-color-${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)})`, border: "1px solid var(--tangent-color-border)", height: 24, width: 48 }} /><span>{name}</span></div>)}</div>
};

export const Typography: StoryObj = {
  name: "Foundations/Typography",
  /** Renders the Storybook example. */
  render: () => <div><h1>Tangent title</h1><p>Readable telemetry text with compact hierarchy.</p><code>monospace renderer</code></div>
};

export const Spacing: StoryObj = {
  name: "Foundations/Spacing",
  /** Renders the Storybook example. */
  render: () => <div style={{ display: "grid", gap: "var(--tangent-density-gap)" }}><button className="tg-button tg-button--secondary">Density gap</button><button className="tg-button tg-button--secondary">Second row</button></div>
};

export const Density: StoryObj = {
  name: "Foundations/Density",
  /** Renders the Storybook example. */
  render: () => <div data-density="compact"><button className="tg-button tg-button--secondary">Compact control</button></div>
};
