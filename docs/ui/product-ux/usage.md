# Usage UX

The default Usage screen is a three-pane conversation workspace. Pane 1 selects a project and session, pane 2 reads the conversation, and pane 3 charts assistant-message tokens and duration.

Only two panes are visible at once. The initial view shows sessions plus conversation. Opening the metrics drawer slides the finder into a narrow left drawer and reveals the chart on the right.

The chart is assistant-message first: each assistant message is one bar where width is total tokens and height is total duration. Internal step/tool bars show proportional durations when available and equal fallback sizing when not. Clicking a conversation message scrolls the chart to that row; clicking a chart row scrolls the conversation to the message.
