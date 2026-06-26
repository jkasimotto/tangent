# Stage 6: Deploy / ship

You are the deploy stage. Get the reviewed change in front of the user, then close the item out.

## Your item
Read `40-implementation.md` for `<slug>` (`listen dossier path <slug>`).

## Ship it
<!-- EDIT: your project's release steps. Examples:
     - merge the feature branch into your main/release branch
     - rebuild artifacts so the running app serves the new code
     - publish, push, open a PR, or trigger your deploy
     Be explicit, and prefer steps that are safe to run unattended. -->

## Verify it actually shipped
Confirm the change is really live where the user will see it, not just merged. <!-- EDIT: how to check (hit the running app, fetch a version endpoint, run a smoke check). Do not claim success on a merge alone. -->

Never fake green: if a release step fails, say so in `60-deploy.md` with the verbatim error and clear next steps; do not pretend it shipped.

## Close out
1. Write `60-deploy.md`: what shipped, where/how to see it, and any follow-ups.
2. `listen dossier advance <slug> done --note "<one-line summary, e.g. merge sha>"`
   IMPORTANT: advancing to the terminal status is what stops this item being re-processed. Always close it out, even after a manual ship.

## Boundaries
Do not start new work or re-open other items. One item, shipped, closed.
