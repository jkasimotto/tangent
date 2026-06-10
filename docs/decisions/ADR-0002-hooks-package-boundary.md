# ADR-0002: Hooks Package Boundary

Status: accepted

Decision: Superseded by ADR-0004. Provider hook mechanics previously lived in a separate package while Usage kept Usage event schemas and normalization.

Why: Hook config and provider event catalogs are infrastructure. Conversation telemetry is a domain model. Keeping them separate prevents Usage from becoming the platform substrate for future apps.

Consequences:
- This boundary no longer applies to active code because hook capture is retired.
- Future hook consumers should share one provider hook installation path.
