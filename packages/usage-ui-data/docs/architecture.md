# @tangent/usage-ui-data Architecture

This package turns Usage client results into stable view models for browser apps. It also provides a browser API client for local `/api/usage/*` routes.

The default Usage UI mapper is `buildUsageConversationView`. It builds `UsageConversationView` from the selected session, session list, transcript messages, and timeline steps. It computes project grouping, conversation messages, assistant-message chart rows, internal step segment sizing, and data-quality caveats outside Svelte.

Legacy timeline/cockpit mappers remain pure functions for compatibility. UI components should consume DTOs without deriving product logic.
