import type { UsageCost, UsageTokenUsage } from "../schema/index.js";

export type UsagePricingInput = {
  provider?: string;
  model?: string;
  tokens?: UsageTokenUsage;
};

export type UsagePricingPlugin = {
  id: string;
  price(input: UsagePricingInput): UsageCost;
};

export function unpricedCost(model?: string): UsageCost {
  return {
    currency: "USD",
    source: "unknown",
    priced: false,
    unpricedModels: model ? [model] : undefined
  };
}
