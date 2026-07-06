# @tangent/usage-ui-data Public API

Public import paths:
- `@tangent/usage-ui-data`

Important exports:
- `UsageUiClient`
- `createUsageApiClient`
- `createUsageUiClient`
- `UsageUiClient.getConversationView(id, query?)` returns `UsageConversationView` for the default Svelte Usage UI.
- `UsageConversationView` defines the project/session picker, conversation messages, assistant-message chart rows, internal step segments, and caveats.
- `UsageConversationSessionItem` exposes compact picker metadata including provider, primary model, last activity, messages, and tokens.
- `UsageConversationChartRow` exposes cumulative context tokens and per-work-turn added-token modes for chart display.
- `buildUsageConversationView` maps Usage domain data into the conversation DTO.
- `UsageUiClient.getSessionTimelineView(id, query?)` returns the legacy `UsageSessionTimelineView`.
- `UsageSessionTimelineView` and `UsageTimelineStepBar` define the horizontal session timeline DTO.
- `buildUsageSessionTimelineView` maps Usage domain data into the minimal timeline DTO.
- Existing cockpit DTOs and pure mappers remain exported for compatibility.
- `buildInsightsFeedView` maps the Insights API response into `UsageInsightsFeedView` (distribution categories, remedy chips, visible/parked findings, optional eval-run exclusion count).
- `createInsightsApiClient` is the browser client for the Insights feed and its park/unpark mutations.
- `groupSessionsByProject` builds the browse view's project rail; sessions without a derivable project group under `NO_PROJECT_LABEL` ("(no project)") and sort last.
- `deriveDisplayTitle`, `isCommandXml`, `isTaskNotificationXml`, `stripCommandMarkup`, `taskNotificationLabel`, and `extractCommandName` sanitize machine markup (slash-command XML, task notifications) out of conversation titles.
- `middleTruncatePath` abbreviates long absolute paths for tool chips (first segment plus last two).
