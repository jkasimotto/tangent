# A simple ontology for vault documents: user intent

Date: 2026-08-28

This note preserves Julian's words before the design changes them into decisions. It extends `../agent-shell-operating-vision/user-intent.md` and `../area-note-as-system-prompt/design-record.md` section 1.

## The Goal

`otto/tangent/goal-design-a-simple-ontology-for-vault-documents.md`, done when:

> One durable reviewed design defines the smallest useful ontology and placement rules for Tangent vault files, enabling informal brain conversations about project state and priorities, a clear home for agent-only material and Area skills, and a few justified first-class UI concepts without formalizing Markdown flexibility.

## The assignment, as the brain relayed it

> Julian wants to brain-vomit informal project thoughts to an Area brain, have it store state, progress, priorities, what matters, and who does what correctly, then orient him later. He currently reads Designs. Agents need a verbose private place that does not clutter his reading surface. Some few kinds may become first-class UI. HARD CONSTRAINT: keep this informal and aggressively simple. Do not create a knowledge-management system, required user maintenance, needless schemas, or proliferating kinds. Preserve flexible Markdown and graceful ambiguity.

The two studies it synthesizes were assigned the same day with these words (from the Claude study's record of its Goal instruction):

> a useful, simple document ontology for the Tangent/Obsidian vault. He reads designs today. Next he wants to talk to an Area brain about project state, progress, priorities, what matters and who is doing what, then have the brain store that and give it back correctly later. He needs a place for verbose agent-only communication. Markdown flexibility is precious. The result must be informal, low-ceremony, and aggressively resistant to over-formalization. Decide the smallest set of durable kinds and folder rules that removes loose notes without turning the vault into a CMS.

And the brain's addition about skills:

> each Area will have `.agents/skills` and `.claude/skills`, symlinked. Decide their canonical home, whether they are an agent resource rather than a Document, how the two paths relate, inheritance into child Areas, and how to stop symlinks from making duplicate Documents or UI clutter.

## Julian's own words that bind this design

On the operating philosophy (2026-08-27, voice memos and answers, `../agent-shell-operating-vision/user-intent.md`):

> You are overcooking it with terms etc. The operating philosophy is that tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents etc.

> Almost all facts for brain should be stored in md.

On skills (memo 2, 2026-08-27):

> I would rather organize my personal agent skills and like knowledge repository for how to do things by area in tangent rather than [by] repository.

> we don't need any like first class concept for this, I don't think. I think if we take the .agents folder and we also create a .claude folder and we [symlink] the .claude to the .agents within each area, then every brain will be aware of that, because the brains should open in the tangent repository.

> the workers should never really be spawned in the tangent repository. The worker should be spawned in the work repository. Yeah, so the brains will have access to the skill and will be able to forward it or reference it to the workers to say, hey, do this. Well, this is the skill.

On the note as the brain's instruction file (2026-08-27, `../area-note-as-system-prompt/design-record.md`):

> We basically treat each area note as an AGENTS.md in fact maybe we just do that. That so simple. We have one AGENTS.md and one CLAUDE.md symlinked to that per area.

> It better not be in the AGENTS.md one. There's no need for it there. Goals should just be goal-slug files in the area repo.

On the Journal (`../agent-shell-work-briefing/design-record.md` section 2):

> If I say a keyword while talking to a brain, it just does spew.

> We need to save my exact words.

> It is probably good to save the entirety of what I was saying in one place. And then the rest can get routed as well.

On what he reads (2026-08-20, Goals `goal-the-work-desk-is-compact-no-documents-list-time.md` and `goal-a-decision-row-is-the-document-to-read-and-repli.md`, as recorded in `../agent-shell-presented-documents/user-intent.md`):

> the work view is his everything view, so it must show work only

> when decisions need to be made, the card should just show him the doc name to read; he leaves comments in the Document and marks the decision done

> The Area view is rarely opened

On people (2026-08-24, `otto/tangent/tangent.md` Ideas): a dashboard of who works on what is deferred by his own words as "extra unspecified work", and "belongs with the assignee and people-per-Area concept, not before it".

His reactions inside Documents, which show what over-formalization looks like to him (`otto/tangent/design-make-the-brain-less-of-a-bottleneck.md`, `design-define-tangent-s-ontology.md`):

> What the fuck does this concretely mean?

> What the fuck is a resource lane?

> Have you just made this up?

> There is either active or inactive. That is all. Two states. Currently we have stupid duplicate states for "inactive".

## What the words ask for, in one list

1. Talk informally to a brain about state, progress, priorities, what matters, and who does what. The brain stores it correctly and orients him later.
2. Keep reading designs. Do not add reading surfaces.
3. Give agents a verbose place of their own, out of his face.
4. Skills per Area, in `.agents/skills`, with `.claude/skills` linked, visible to brains, handed to workers by the brain.
5. No new terms, no schema, no maintenance for him, plain Markdown, ambiguity tolerated.
6. Few kinds, each with a reason to exist. Fold the rest.
