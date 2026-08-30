# Agent Shell navigation model: user intent

Date: 2026-08-27

This note preserves Julian's request before the design changes it into implementation details. It extends, and does not replace, `../agent-shell-work-contract/user-intent.md`.

## Julian's words, condensed

- Agent Shell was built up by requesting features over time. Nothing was unified or principled. Recent work has started to move it back in that direction.
- The key principle is keyboard first. "I like Vim. I like Neovim and how the latency between my intention and the action is minimized. I want the same thing for Agent Shell."
- "I really like jumping around." Named intentions:
  - enter the worker agent;
  - enter the brain;
  - control the pipeline: stop an agent in the pipeline, restart an agent in the pipeline;
  - change the harness of an agent in the pipeline.
- "Underpinning all of this is a model of what is a Goal and where that information gets stored. The tmux session key is really useful."
- Task: take stock of everything that is there. Map the workflow, the UI, the UX, every action and state transition. Design one unified navigation model that embraces both the keyboard and the mouse.
- No code yet.
