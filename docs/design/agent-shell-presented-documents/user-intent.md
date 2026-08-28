# User intent: agents present their documents as first-class UI

Date: 2026-08-28. Source: Goal `otto/tangent/goal-agents-present-their-documents-as-first-class-ui.md`, assignment 1, as relayed by the brain.

## What Julian wants

- An agent wrote a document and wants Julian to read it. Today Julian must enter the agent chat, find the document name, press Cmd-K, and paste it.
- The human title of the document differs from its file name. That causes cognitive dissonance.
- Agents must be able to present associated documents directly. Julian must be able to enter them easily.
- The Work view is Julian's everything view. The design must fit it, the agent and session surface, the Goal, Request, and Document model, keyboard navigation, and the existing reader and search.
- Resolve responsibility: does the Area brain curate and present documents, can workers declare produced or presented documents, and what invariant stops documents from littering the UI.
- Consider provenance, several documents, relevance and order, stale or completed work, and how presentation differs from a link or a Request.

## Done when

A designed and implemented Agent Shell flow lets Julian open documents produced or presented by an agent directly by their human title, without searching or translating a title into a filename. Document ownership, brain responsibility, and anti-litter invariants are explicit and verified.

## Earlier words that bind this design

- 2026-08-20, on the work desk: cards must be "way more compact"; remove the Documents list from the Work tab; "the work view is his everything view, so it must show work only" (`goal-the-work-desk-is-compact-no-documents-list-time.md`).
- 2026-08-20, on the For you card: "when decisions need to be made, the card should just show him the doc name to read; he leaves comments in the Document and marks the decision done" (`goal-a-decision-row-is-the-document-to-read-and-repli.md`).
- 2026-08-20, on Go To: pressed Cmd+K, typed `design-done-goals`, got "Nothing is named" (`goal-go-to-finds-a-document-by-its-file-name.md`).
- 2026-08-28, ADR-0041: "everything through brain".
