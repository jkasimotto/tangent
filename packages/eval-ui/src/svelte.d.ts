declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<Record<string, never>>;
  export default component;
}

declare global {
  var __dynamicImportForTest: ((path: string) => Promise<unknown>) | undefined;
}

export {};
