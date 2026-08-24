# Document brain actions

## Problem

The Document toolbar can notify the covering Area brain about comments, but the same control cannot take Julian to that brain. Success means the control offers both actions without adding permanent toolbar clutter. Starting, resuming, or changing a brain is out of scope.

## Evidence

**Existing system:** the toolbar already resolves the nearest live covering brain and `data-open-brain` already opens its terminal. The current notify action is disabled when there are no comments.

**Internal precedent:** the reader uses native `details` popovers for its Document picker and compact outline.

**External precedent:** none needed for this small, repository-local interaction.

**Implication:** reuse the reader popover and the existing open-brain event contract.

## Principles

- Keep both related brain actions discoverable at the point Julian already uses.
- Do not add another always-visible toolbar action.
- Keep “Go to brain” available even when there are no comments to notify about.

## Recommendation

Turn the existing blue action into a native `details` menu. Its trigger keeps the current “Tell … brain I added comments” label and adds a disclosure mark. The menu contains “Tell brain I added comments” and “Go to brain.” Only the notify item is disabled when the Document has no comments.

Workflow: Julian opens the action, then either notifies the brain and stays in the Document, or opens the live brain terminal. Native summary keyboard behavior and the existing terminal return point preserve accessibility and navigation context.

## Decisions

Use a two-item popover, not two toolbar buttons. Two buttons save one click but consume scarce toolbar space and make a secondary navigation action permanently prominent. Reconsider if either action becomes a dominant, high-frequency path.

Keep the current long trigger label, rather than replacing it with generic “Brain.” It preserves recognition for the existing workflow. Reconsider if toolbar compression shows the label no longer fits common viewports.

## Risks / open questions

The long trigger can still be tight on narrow screens. Existing toolbar responsive behavior remains unchanged; observed clipping would justify shortening it separately.
