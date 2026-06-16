# Usage UX

The default Usage screen is a three-pane conversation workspace. Pane 1 selects a project and session with accordion project groups, pane 2 reads the conversation, and pane 3 charts assistant-message tokens and duration.

The finder keeps project groups visible while conversations expand underneath each project. Conversation rows should favor scan-ready telemetry over transcript text: last activity, session duration, total tokens, message count, tool calls, provider, and status.

The chart is assistant-message first: each assistant message is one bar where width is total tokens and height is total duration. Internal step/tool bars show proportional durations when available and equal fallback sizing when not. Clicking a conversation message scrolls the chart to that row; clicking a chart row scrolls the conversation to the message.
