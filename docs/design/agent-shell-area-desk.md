# Agent Shell area desk

Status: accepted product contract

Date: 2026-08-14

## Product promise

Agent Shell is a dispatch desk for several streams of work.

The user can answer four questions without opening another page:

1. Which Areas exist?
2. Which agent needs attention?
3. What change is each agent making?
4. Which Document restores the full context?

The interface uses the user's stable subject map. It does not use machine state as the primary map.

## Product objects

The product has four visible objects.

| Object | Purpose | Visual form |
|---|---|---|
| Area | A durable subject such as Tangent, D&D, or Launcher | A stable rectangular region on Work |
| Goal | A desired change | A readable row inside its Area |
| Run | One live conversation with an agent | A state label and a direct action on its Goal |
| Document | Durable knowledge for an Area or Goal | A document link with a separate visual style |

Summary is not a product object. Status is not a destination.

## Mental model

The Work page is an area map.

Each Area keeps a stable position in the grid. A Run can change state without moving its Area.

This stability lets the user build spatial memory. The user can look where Tangent or D&D usually appears.

The page can show a small attention queue above the grid. This queue contains direct links to waiting agents.

The queue is an action index. The area grid remains the canonical map.

## Navigation

Work, Areas, and Programs are persistent top-level tabs.

The tabs stay visible on each product page. When one tab is empty, their position does not change.

The normal routes are:

| From | Action | Destination | Back destination |
|---|---|---|---|
| Work | Open a waiting or working Run | Native agent | Work |
| Work | Start a ready Goal | Native agent | Work |
| Work | Open a Document | Document reader | Work |
| Work | Open Goal details | Goal detail | Work |
| Document | Open agent | Native agent | Same Document and reading position |
| Areas | Open a Document | Document reader | Areas |
| Programs | Open a Program | Program detail | Programs |

The Goal detail is optional. It never blocks the route from Work to an agent or Document.

Agent Shell opens on Work. A Goal that the user selected in an earlier visit does not replace Work.

## Work page

The Work page has three levels.

### 1. Attention queue

When one or more agents need the user, the queue appears.

Each item shows the Area, the full Goal name, and the agent name. Selecting it opens that agent.

The queue does not open Goal details first.

### 2. Area grid

The grid uses two columns on a wide window and one column on a narrow window.

Each Area region shows:

- the Area name.
- a plain-language state summary.
- active Goal groups.
- linked Documents.
- a Describe work action.
- an Organize Area action.

The grid uses stable Area order. Waiting state does not reorder the grid.

### 3. Goal group

A root Goal and its Subgoals form one Goal group.

The root Goal uses the strongest text. Subgoals use an indented checklist shape and a smaller label.

The interface shows the complete Goal name. It does not truncate the name.

A Goal row can open the agent, open Goal details, or mark the Goal complete.

## Documents

Documents are primary context, not metadata at the end of a Summary.

Each Area shows its Documents beside its active Goals. A Goal also shows its linked Documents before its history.

Document links use a different type style and shape from Goal rows. This difference supports fast object recognition.

The Document reader remains the dominant reading surface.

## Goal details

Goal details provide optional inspection and control.

The page shows this order:

1. the Goal name.
2. the current brief.
3. linked Documents.
4. Run controls.
5. parent and child Goals.
6. optional history and personal notes.

The history stays collapsed by default. Meaningful moments do not appear on Work or Area cards.

## Describe work

Describe work is the capture point for a large context dump.

The user selects an Area and gives the complete thought once. Agent Shell opens one definition Run with that context.

The agent can propose one Goal group. The group can contain a root Goal and several Subgoals.

The root Goal records the complete assignment. Subgoals identify results that need separate focus.

The user does not repeat the original context for each Subgoal. Linked Documents travel with the Goal group.

The definition Run appears in its Area with a `Defining work` label. It uses the same direct attention behavior as other Runs.

## Visual grammar

The interface uses shape, position, type, labels, and color together.

- Areas use firm rectangular boundaries and a persistent header.
- Goals use flat rows with strong names.
- Subgoals use indentation and connectors instead of smaller copies of Goal cards.
- Documents use a document marker and a reading type style.
- Runs use explicit state words.
- Orange means waiting for the user.
- Blue means an agent is working.
- Green means complete.

Color does not carry meaning by itself.

The interface removes decorative gradients, pill shapes, and hover movement from the Work page.

The interface does not use a deliberately difficult font. Font difficulty adds reading cost without reliable memory gains.

## Product precedents

Linear gives each durable team a home for work and pinned resources. It also keeps projects, issues, and Documents distinct.

GitHub Projects supports different layouts for different reading tasks. One repeated card shape is not the only possible work view.

Apple's tab guidance keeps top-level destinations visible and stable. Hidden tabs make an interface feel unpredictable.

Visual working-memory research reports a capacity near three or four items. The design groups details under stable Areas.

References:

- [Linear Teams](https://linear.app/docs/teams)
- [Linear Projects](https://linear.app/docs/projects)
- [GitHub project views](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project)
- [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- [Visual working-memory capacity](https://pmc.ncbi.nlm.nih.gov/articles/PMC3729738/)
- [Disfluent font replication](https://journals.sagepub.com/doi/10.1177/21582440211056624)

## Acceptance contract

These statements define a complete implementation:

- Agent Shell opens on Work after a restart.
- Work, Areas, and Programs remain visible as top-level tabs.
- Work shows a stable Area grid.
- A waiting item opens its native agent in one action.
- Back from a Goal agent returns to Work in one action.
- Back from a Document agent restores the Document.
- Goal names wrap instead of truncating.
- Documents are visible from Work without a Summary detour.
- A Goal can be marked complete from Work.
- Subgoals do not look like root Goals.
- Meaningful moments do not occupy the Work page.
- Program controls do not terminate unrelated agent sessions.
