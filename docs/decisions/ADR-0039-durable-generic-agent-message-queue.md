# ADR-0039: Generic agent messages survive controller restarts

Date: 2026-08-27

Status: accepted

## Context

`tangent agent send` previously stored queued messages only in controller memory.

A controller restart lost those messages. A wake could also occur before any durable write.

Brain notices and workflow reminders use different records. Some reminders contain live functions and cannot be serialized safely.

## Decision

Agent Shell stores each generic agent message before it wakes or writes to a pane.

The stored record contains a generated ID, exact resolved session, sender, Area, normalized body, provenance flag, and queue time.

The controller restores these records in first-in, first-out order after a restart. Retargeting preserves the resulting target order.

A record remains durable while pane presentation is in progress. Agent Shell removes it after presentation settles or the exact target session ends.

This queue stores only generic `tangent agent send` messages. Brain inbox notices and live workflow reminders keep their existing authorities.

The file uses the `agent-message-queue.v1` schema. Its default path is `~/.tangent/agent-shell/message-queue.json`.

## Consequences

A failed store write cannot wake a pane or expose an in-memory-only message.

Controller restarts do not lose accepted generic messages.

The target remains an exact runtime session. This release does not add a logical recipient or a model-read acknowledgement.

Presentation settlement proves that Tangent wrote the message through the supported prompt transport. It does not prove that the model read it.

An unknown harness can keep a message queued because safe pane presentation still requires a recognized empty composer.
