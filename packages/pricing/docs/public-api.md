# @tangent/pricing Public API

Public import path:
- `@tangent/pricing`

Usage shape: `TokenUsage`, `emptyUsage`, `addUsage`, `sumUsage`, `promptTokens`, `totalTokens`, `isEmptyUsage`.

Rates: `builtInRates`, `rateFor`, `mergeRates`, `TokenRate`, `RateEntry`, `RateOverride`.

Cost: `priceUsage`, `totalCost`, `PriceModifiers`, `PricedUsage`, `PricedTotal`.

Display: `formatUsd`, `formatTokens`.

Agents must import through the package root, not package internals.
