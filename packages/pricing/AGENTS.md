# @tangent/pricing

Purpose: the provider and model token rates every Tangent app prices with, and the cost maths that turns token counts into dollars.

Read next:
- docs/index.md

Local rules:
- Never guess a rate. A model with no published or account-holder number stays unpriced, and the caller reports which model it could not price.
- Every rate entry names its source in the entry itself.
- Keep the package pure: no filesystem, no network, no transcript formats. Callers read files and hand this package numbers.
