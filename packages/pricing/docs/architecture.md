# @tangent/pricing Architecture

A platform package with no Tangent dependencies. It owns three things and nothing else.

1. `TokenUsage`, the one usage shape. Harnesses disagree about what `input_tokens` means: Anthropic excludes cache reads from it, OpenAI leaves cached tokens inside it. `TokenUsage.input` fixes one meaning, the tokens charged at the full input rate, and every reader normalizes to it before pricing.
2. The rate catalog. Each entry names a provider, the model ids it matches, the rate, and the source of the numbers. A model with no entry comes back unpriced rather than guessed at, and `mergeRates` lets an account holder supply rates the catalog cannot verify.
3. The cost maths. Token buckets times rates, then the per-conversation modifiers that are not token-priced: fast mode, the United States inference surcharge, and per-request web search.

Rules:
- Reasoning tokens are never billed. Every provider that reports them counts them inside `output` already.
- `totalCost` carries its exclusions. A part that had tokens and no rate is named in `unpriced`, so a surface can state what a number leaves out instead of quietly under-reporting.
- These are API list prices. Under a subscription they measure work, not spend. Surfaces must say so.
