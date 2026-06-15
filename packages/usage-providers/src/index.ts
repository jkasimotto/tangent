export type UsageProviderDescriptor = {
  id: string;
  label: string;
};

export const builtInUsageProviders: UsageProviderDescriptor[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" }
];
