# @tangent/trees-core Architecture

Core receives an event store interface and projects resources from append-only `TreeEvent`s. Adapters live outside this package and feed core with typed events and observations.

Core must not know about concrete tmux commands, SQLite drivers, React components, iTerm automation, or old `pa` storage.
