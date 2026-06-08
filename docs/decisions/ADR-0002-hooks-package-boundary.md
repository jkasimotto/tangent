# ADR-0002: Hooks Package Boundary

Status: accepted

Decision: Provider hook mechanics live in @tangent/hooks. Convos keeps Convos event schemas and normalization.

Why: Hook config and provider event catalogs are infrastructure. Conversation telemetry is a domain model. Keeping them separate prevents Convos from becoming the platform substrate for future apps.

Consequences:
- @tangent/hooks must not import @convos/convos.
- Convos installs provider hooks through @tangent/hooks with an injectable record command.
- Future hook consumers should share one provider hook installation path.
