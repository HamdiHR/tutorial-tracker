# Backlog (recorded only, nothing implemented until requested)

## 1. Bulk status management — DONE (v0.2)
_Implemented: Manage progress page (select tickets/sprints, Mark done / Reset, confirm + Undo), sprint menu on the dashboard, and “Mark all steps done / Reset all steps” in the ticket status dropdown._

**Problem:** status can only be changed ticket by ticket (or step by step). There is no way to mark a whole sprint, or everything, as done in one action.

**Wanted:** mark a whole sprint (and possibly all sprints) as done without touching each ticket.

**Open questions for when we implement it:**
- Scope: per sprint button, "select several tickets" checkboxes, or both?
- Should "done" also tick every step inside (so progress % and the heat-map reflect it), or only set the ticket status override?
- Other bulk actions: reset a sprint to To do, mark as Blocked?
- Confirmation + undo (a mistaken "mark all done" is easy to make).

## 2. Overall progress looks wrong — DONE (v0.2)
_Cause confirmed: tickets marked Done by status kept 0 ticked steps (reproduced: 2 tickets done, 0/778 steps). Now “Done” always ticks every step, and existing databases are migrated on first start._

**Reported:** two sprints are finished, but the dashboard shows "Overall progress 2%, 12 / 778 steps completed".

**Likely cause (not yet confirmed):** progress counts only *checked steps*. If those sprints were finished by setting the ticket status to Done (the status dropdown), the ticket is Done but its steps stay unchecked, so they add 0 to the step total. Related to item 1 (bulk status).

**To check when we work on it:**
- Compare the "Tickets done" card with the step count for the same sprints.
- Decide the rule: should a ticket marked Done manually count all of its steps as completed?
- Maybe base the overall % on tickets, or weight both consistently, so the numbers can't disagree.

Ideas for later versions are collected in SUGGESTIONS.md.

v0.3 and v0.35 were built from your requests (full width, timeline, team, task view, Scrum board).
