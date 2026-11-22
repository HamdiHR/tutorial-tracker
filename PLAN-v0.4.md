# v0.4 plan: Board and Timeline upgrade

Status: **in progress** (decisions recorded below, P1 built).
Baseline: v0.39 (hosted on Vercel + Supabase, local mode still supported).

---

## Decisions (recorded 22 Nov 2026)

| # | Question | Decision |
|---|----------|----------|
| Q1 | What does "assign user" mean? | **Option A.** Every account keeps its own separate progress. "Assign" splits the work between **you and your AI coding assistant ("vibe coding" with Claude)**: some tickets are yours, some are for Claude. Assignees are plan members with a kind (`human` or `ai`), not extra logins. Shared workspaces are out of scope. |
| Q2 | Board ideas | Up to me: do the recommended ones (see "Board scope" below). |
| Q3 | Attachments | **All file types, focus on images** (image compression + thumbnails + lightbox; other files stored and listed with icon, size and download). |
| Q4 | Version | This work ships as **v0.39.x** (package `0.39.1` for the first checkpoint), and the version is shown as a **badge next to the title in the sidebar**. |
| Q5 | Default anchor | **Yes: "Continue from where I am" is the default** whenever progress exists. |

### What the "AI assignee" changes in the plan
- Team members get a `kind` (`human` | `ai`) and a distinct avatar (spark icon). Default team for a new plan: **You** and **Claude**.
- The auto-split stays balanced by workload, but the user can pin tickets to "Claude" or "Me" in one click (drawer, board card menu, timeline drag between lanes).
- New **"Hand off to Claude" brief** in the drawer for AI-assigned tickets: one click copies a ready-to-paste prompt (ticket id/title, the steps with their text, your note, subtasks, attached image names, acceptance checklist, "report back with ..."). No API calls and nothing leaves the browser, so it stays free.
- Review loop: an AI-assigned ticket gets an extra column state on the board, **"Claude done, needs my review"** (a label, not a new status), so work handed back is not silently counted as finished until you tick it.
- The timeline lane for Claude uses its own working days (default 7 days, no days off) because it is not limited by your schedule.

### Board scope (what I will build, in order)
Richer cards (assignee, subtasks, attachments, due chip, labels) · WIP limit per column · swimlanes (sprint / assignee / label) · quick add and inline rename · saved filters and search in notes/subtasks · collapse columns + density · blocked reason · "Today" strip · board undo · sprint burndown mini-chart. Left for later: cover images, time tracking, automations, notifications.

### Delivery status
- [x] **P1 Smart dates** (anchor modes, history from the activity log, partial sprints, target end date, forecast range, 18 scenario tests) and **version badge**: built in 0.39.1.
- [x] P2 task drawer (opens from board cards and timeline bars) · [x] P3 subtasks, priority, labels, blocked reason, assign to you or Claude (AI) · [x] P4 attachments (local disk, or Supabase Storage free tier when hosted; images compressed to WebP) · [x] P5 Gantt roadmap + team lanes + calendar + agenda + sprints views · [x] P6 board polish (priority/labels/subtasks on cards, WIP limits, grouping, saved views, collapse, density, review ribbon) · [x] P7 hardening: 41 tests, storage RLS checks, hosted upload e2e.
- [x] **0.39.2:** shareable task link (`/?t=<ticket>`, "Copy link" in the drawer), per-task comments (as you or as Claude), burndown chart (plan vs real), `.ics` calendar export. Board status moves already had Undo.
- [x] **0.39.3:** custom saved board filters (stored per account), timeline minimap, dependency arrows ("Depends on" in the drawer, red when the plan conflicts), "What if…" scenario planner.
- **Not built (honest list):** nothing from this plan is left. Dependencies are shown and warned about, but do not move dates automatically.

---

## 0. What we found in the current code

These facts shape the plan, so they come first.

1. **Why the timeline ignores completed sprints.** `server/plan.js` `computeSchedule()` starts one cursor at `plan.startDate` and gives *every* sprint with tickets its own block of working days in order. It never looks at progress when placing sprints. If Sprints 1-3 are done and you set the start to today, Sprint 1 is scheduled "today", Sprint 4 lands weeks later, and the plan says you are far behind. Progress is only used afterwards, for the "expected vs actual %" comparison.
2. **Team members are plain names stored inside the plan JSON** (`plan.team[]`), not user accounts. "Assign user" today means "assign a plan member". In hosted mode, invited people have separate accounts *and separate progress* (row-level security isolates each user).
3. **Tickets have a note** (`tickets.note`) and **steps have notes**, but there are no subtasks, attachments, comments or labels.
4. **Board** (`web/src/board.js`, 250 lines): 5 columns, drag and drop, filter by sprint/person, owner avatar menu. A click on a card currently navigates to the full ticket page.
5. **Timeline** (`web/src/timeline.js`, 366 lines): list/calendar-style view of sprints with a Tasks view lanes per person, draggable bars. Functional but plain.

---

## 1. Goals

| # | Goal | Success looks like |
|---|------|--------------------|
| G1 | Smart timeline dates | Any combination of finished / half-done / skipped sprints produces a sensible calendar with no manual fixing |
| G2 | Task drawer | Click a card or bar and a side panel opens (no page change) with assignee, notes, subtasks, images, dates, history |
| G3 | Modern timeline UI | A Gantt-style view that is pleasant to read and to drag around, on desktop and phone |
| G4 | Board polish | Faster triage, WIP awareness, richer cards, keyboard flow |
| G5 | Stay free and light | Free-tier services only; first-load JS stays small; local mode keeps working offline |

---

## 2. Smart timeline dates (G1)

### 2.1 The problem in one picture
```
Today: 22 Nov     Plan start date: 22 Nov
S1 done  S2 done  S3 done  S4 in progress (40%)  S5..S11 untouched
Current result:   S1 22-28 Nov, S2 29 Nov-5 Dec, S3 ... S4 ... (everything shifted into the future)
Wanted result:    S1-S3 shown as completed in the past, S4 = remaining work starting now, S5+ follow
```

### 2.2 New concept: "anchor"
Replace the single "start date" question by an **anchor** the planner can reason from. Three anchor modes (user picks one, with a smart default):

1. **Start date of sprint 1** (today's behavior): everything is laid out from this date. Completed sprints are drawn as done in that window.
2. **"I am here" (default when progress exists)**: the first unfinished ticket/sprint starts on a chosen date (default: next working day). Everything before it is history; everything after is scheduled forward.
3. **Target end date**: you give a deadline and the planner works backwards, computing the daily pace needed and flagging if it is unrealistic.

### 2.3 Rules the scheduler must handle (the "all cases" list)
| Case | Behavior |
|------|----------|
| Some sprints fully done, rest untouched | Done sprints become **history** (no future days consumed); schedule resumes at the anchor |
| Sprint partly done | Only the **remaining tickets/steps** are spread over the sprint's days; the sprint's window starts at its real or planned start |
| Completed out of order (S5 done, S3 not) | Done work is history wherever it sits; remaining sprints keep tutorial order |
| Everything done | Show "Completed" with total elapsed days; no future schedule |
| Nothing done | Behaves like today |
| Started before the plan start date | Use real completion dates (from activity log) as history; they may precede the plan start |
| Skipped / deferred tickets | Excluded from capacity and from the "late" calculation (already partly handled by `deferred`) |
| Behind schedule | Offer three one-click options: **shift everything forward**, **compress remaining sprints** (fewer days each), **extend end date**; show impact before applying |
| Ahead of schedule | Show buffer days and the projected finish date |
| Days off / holidays / different weekdays per person | Already supported; stay supported, and holidays can be imported from a country preset |
| Team of N people | Capacity is summed per person; a person's absence moves only their tickets |
| User returns after weeks away | "Re-plan from today" action keeps history and re-spreads remaining work |
| Plan changed after progress exists | Never rewrite history, only the future part |

### 2.4 Real dates become the source of truth for history
- Use the **activity log** (completion timestamps) to know when each ticket/sprint was really finished. Planned vs actual then becomes accurate instead of estimated.
- If a ticket was bulk-marked done (onboarding "mark previous as done" or Manage progress), it has no real completion date: mark it as **"assumed done"** and draw it in a neutral hatch style on the timeline instead of as a real achievement.

### 2.5 Forecasting
- **Velocity**: steps/day over the last 7 and 14 working days, with a "not enough data" state.
- **Projected finish date** with an optimistic / expected / pessimistic range (simple percentile band, not fancy ML).
- Shown on the dashboard and timeline header: "At your current pace you finish on 14 Feb (±5 days)".

### 2.6 UX of the plan form
- Replace the single form with a short **3-step wizard** that is pre-filled from reality: "You finished Sprints 1-3. Start Sprint 4 on: [date]. How many days per sprint?" with a live preview strip of the resulting calendar before saving.
- A visible **"why is it scheduled here?"** line per sprint (e.g. "capacity 5 days x 1 person, 22 steps remaining").
- Validation messages in plain language (no silent clamping).

### 2.7 Technical notes (design only)
- Keep `computeSchedule()` pure and tested; add a pre-pass that classifies each sprint as `history | active | future` from progress, then runs the existing placement only on `active + future`.
- Plan JSON gets a `version` field and a migration so existing plans keep working.
- Test matrix: build a table-driven test with ~25 scenarios from the rules above (fixtures: progress shape + plan + `today`, expected sprint windows).

---

## 3. Task drawer / modal (G2)

### 3.1 Interaction
- Click a **board card** or **timeline bar** → a **right-side drawer** (full-screen sheet on phones). The URL gets `#/board?t=S2-T03`, so it is linkable and the Back button closes it.
- Keyboard: `Esc` close, `J/K` previous/next ticket in the current list, `E` edit, `A` assign.
- "Open full page" link for the existing long-form ticket view (the tutorial content itself stays there; the drawer is for *managing* the task, not reading the tutorial).

### 3.2 Drawer sections
1. **Header**: ticket id + title, status selector, sprint chip, due date chip, progress ring.
2. **Assignee(s)**: avatar picker. See open question Q1 for what "user" means.
3. **Dates**: start, due, and "planned vs actual"; quick actions "+1 day", "move to next sprint".
4. **Notes**: Markdown note with preview and autosave (existing note feature, bigger and nicer).
5. **Subtasks**: checklist with add / reorder / delete / convert-step-to-subtask; progress rolls up into the card ("3/5").
6. **Attachments & images**: drag-drop, paste from clipboard, camera on mobile; thumbnails with lightbox.
7. **Labels / priority**: color labels (Bug, Blocked-by-X, Review) and a priority flag.
8. **Activity & comments**: a per-ticket timeline ("status changed", "note edited", "image added") plus optional comments.
9. **Steps preview**: the tutorial steps with checkboxes (so a ticket can be advanced without leaving the board).

### 3.3 Image upload on a free tier
Requirement: free, simple, works hosted and locally.

| Option | Free allowance | Verdict |
|--------|----------------|---------|
| **Supabase Storage** (already in the stack) | 1 GB storage, 50 MB max file size, bucket policies reuse our auth/RLS | **Recommended** for hosted mode, no new account or vendor |
| Vercel Blob | small hobby quota | works, but a second place to manage and no RLS |
| Cloudinary free | 25 credits/month, nice transforms | extra signup and public URLs by default |
| Imgur / imgBB | free but public and terms can change | rejected: privacy |
| Local mode | disk | store in the data folder next to the database (included in backups) |

Design decisions:
- **Private bucket** `task-files` with path `user_id/ticket_id/uuid.webp` and storage policies so each user can only touch their own prefix. Images are shown through short-lived **signed URLs**.
- Vercel functions cap request bodies at about 4.5 MB, so the browser uploads **directly to Supabase Storage** (the API only issues permission and records metadata).
- **Compress in the browser before upload** (resize to max 1600 px, WebP ~80%) so 1 GB lasts for thousands of screenshots. Limit: 5 MB per file, 10 files per ticket (configurable), images + PDF only.
- A small `tt_attachments` table (id, ticket, path, name, size, mime, created_at) with RLS; storage used per user is shown in Account.
- Cleanup: deleting a ticket's attachment removes the object; a weekly "orphan check" listing in Account (manual, no cron needed on free tier).
- Safety: allow-list of MIME types, sniff the first bytes, never render SVG inline (XSS), strip EXIF GPS data when compressing.

### 3.4 Data model additions (design only)
- `tt_subtasks(user_id, ticket_id, id, title, done, pos)`
- `tt_attachments(user_id, ticket_id, id, path, name, mime, size, created_at)`
- `tt_labels` + `tt_ticket_labels`
- `tt_comments(user_id, ticket_id, id, body, created_at)` (author = user account, see Q1)
- `tickets` gets `priority`, `start_override` (optional)
- All new tables follow the existing pattern: RLS `own` policy, included in `tt_state`/`tt_apply`, `hydrate`/`extract`/`diff` extended, and the local SQLite mirror gets the same tables and a migration. Backups and the Export page include them.

---

## 4. Timeline redesign (G3)

### 4.1 Visual direction
A modern **Gantt / roadmap** feel while staying lightweight (plain SVG + CSS, no chart library):
- **Swimlane roadmap**: sprints as colored bands across a date axis, tickets as rounded bars inside, a glowing "today" line, weekend shading, day-off hatching.
- **Progress inside the bar**: the bar fills as steps are completed; late bars get a subtle red edge, early finishes a green tick.
- **Zoom levels**: Day / Week / Month / Whole course, with smooth pinch/scroll zoom and a minimap strip for quick navigation.
- **Milestones**: end of each sprint, plan end, and the forecast finish date as flags.
- **Dependency hints**: thin connectors between consecutive tickets in a sprint (visual only, no hard blocking).
- **Mini-stats header**: pace, buffer days, projected finish, "next up" card.
- **Motion**: gentle transitions on drag and on data change, honoring `prefers-reduced-motion`.
- **Theming**: uses the existing light/dark tokens, plus a color-blind-safe palette option.

### 4.2 Views
1. **Roadmap** (default): sprints across time.
2. **Team lanes**: one lane per person (exists today, restyled), with workload heat per day.
3. **Calendar**: month grid showing what is due each day (good for phones).
4. **Agenda**: a vertical list "Today / This week / Next week / Overdue" for quick daily use.

### 4.3 Interactions
- Drag to move, drag edges to resize (updates due/start), drop on another lane to reassign, all with **Undo** (already in the product) and snapping to working days.
- Hover card with progress and assignee; click opens the **drawer** from section 3.
- Multi-select + bulk shift ("push these 3 tickets by 2 days").
- "Fit to screen", "Jump to today", and a printable/PNG export of the roadmap.

### 4.4 Phone layout
Horizontal scroll is replaced by the **Agenda** and **Calendar** views by default under 700 px; the Gantt remains available with pinch-zoom.

---

## 5. Board improvements (G4)

Suggested, in priority order (you pick what is in or out):

**Core**
1. **Richer cards**: assignee avatars, subtask counter, attachment count, due-date chip (red when late), label dots, priority flag.
2. **WIP limits** per column (e.g. max 3 Ongoing) with a warning color when exceeded; helps with a solo learner's focus.
3. **Swimlanes** switch: group by sprint (today), by person, by label, or none.
4. **Quick add** at the bottom of each column and **inline rename**; keyboard-first (`N` new card, arrow keys to move focus, `Shift+←/→` to change column).
5. **Saved filters / views** ("My open tasks", "Late", "Blocked") and a search that also matches notes and subtasks.
6. **Column collapse** and a compact density toggle.
7. **Blocked reason**: when moving a card to Blocked, ask for a one-line reason that shows on the card.
8. **Today focus**: a "Today" strip listing tasks due today/overdue, drag them straight into Ongoing.
9. **Undo/redo** history for board moves (extends the current undo).
10. **Sprint burndown** mini-chart above the board (remaining steps per day vs ideal).

**Nice to have**
11. Card **cover image** from the first attachment.
12. **Time tracking**: a start/stop timer per ticket, accumulated time shown in the drawer and used to improve the forecast.
13. **Templates / checklists** for recurring subtasks (e.g. "Test, commit, push").
14. **Automations** (simple rules): "when all steps are done → move to Done", "when a due date passes → flag as late".
15. **Notifications**: in-app reminders for due and overdue tasks (email later, via Supabase and your SMTP once configured).
16. **Confetti restraint**: keep the existing achievements, but make celebration optional in Settings.

---

## 6. More ideas for timeline (suggested)
- **Scenario planner**: "what if I work 2 h/day more / skip Sprint 8?" shown as a ghost schedule over the real one.
- **Auto re-plan nudge**: when you fall behind by more than N days, a banner proposes a new plan with the three options from 2.3.
- **Streak and rhythm overlay**: show the days you actually worked on the timeline.
- **Calendar export (.ics)** so due dates appear in Google/Apple calendar; later a subscribe URL.
- **Share a read-only roadmap link** (hosted mode) for a mentor or friend.
- **Weekly review**: auto-generated summary every Sunday (done, slipped, next week) with a "plan next week" button.

---

## 7. Decisions needed from you (open questions)

**Q1. What does "assign user" mean in hosted mode?** (the most important one)
- A) **Personal planner (today's behavior)**: each account has its own progress; "assign" picks one of the named team members in *your* plan (they do not log in). Simple, no data model change.
- B) **Shared workspace**: invited accounts join *one* project and share tickets, progress and comments; assignment targets real accounts. This is a significant architecture change (workspace table, membership roles, RLS rewritten around workspaces, per-user vs shared progress, realtime sync). Roughly doubles the size of v0.4.
- C) **A then B**: ship the drawer with option A now and make B its own version (v0.5) once you confirm you want real collaboration.
- *Recommendation: C.*

**Q2. Default anchor mode** for people with existing progress: "I am here" (recommended) or keep the sprint-1 start date.

**Q3. Subtasks**: independent of tutorial steps (recommended) or also able to *replace/extend* steps?

**Q4. Attachments scope**: images only, or images + PDF + any file (1 GB total is the free limit)?

**Q5. Priority of board ideas** in section 5: which of 1-16 are must-have for v0.4?

**Q6. Version naming**: you wrote "v0.4"; I read it as v0.40 (the next after 0.39). Confirm, or tell me if you meant 0.4.0 in the "4.0.0" hosted numbering.

---

## 8. Proposed phases (each ends with tests and a deployable build)

| Phase | Content | Why this order |
|-------|---------|----------------|
| **P1 Smart dates** | Sprint classification, anchor modes, history from the activity log, assumed-done marking, new wizard, scenario test matrix, forecast numbers | Fixes the reported bug first; the later UI depends on correct data |
| **P2 Drawer foundation** | Drawer shell, routing (`?t=`), assignee (Q1 option A), dates, richer notes, steps preview; board/timeline open it | One shared component used by both views |
| **P3 Subtasks, labels, priority, comments** | New tables, SQL + local migration, `tt_state`/`tt_apply` extension, hydrate/extract/diff, export/backup | Data first, then attachments |
| **P4 Attachments** | Supabase bucket + policies, direct upload, browser compression, signed URLs, local-mode folder storage, storage meter | Depends on the drawer and on the new tables |
| **P5 Timeline redesign** | Roadmap, zoom, today line, milestones, team lanes, agenda/calendar views, drag/resize with undo, phone layout | Builds on correct dates and the drawer |
| **P6 Board polish** | Chosen items from section 5, WIP limits, swimlanes, saved views, quick add, keyboard flow | Last because it benefits from every earlier piece |
| **P7 Hardening** | Performance budget re-check, accessibility pass (keyboard + screen reader + contrast), e2e tests in a real browser, docs, migration dry-run on a copy of your real data | Ship quality gate |

Rough size: P1 medium, P2 small-medium, P3 medium, P4 medium, P5 large, P6 medium, P7 small. If you want a smaller first release, ship **P1 + P2 + P3** as v0.40 and the rest as v0.41/v0.42.

---

## 9. Constraints and risks

- **Performance**: first load must stay near today's ~80 KB (23 KB brotli). The drawer, Gantt and uploader are lazy-loaded chunks; no chart/Gantt/date libraries.
- **Hosted limits**: Vercel function body 4.5 MB (hence direct uploads), 30 s max duration; Supabase free: 1 GB files, 500 MB database, project pauses after about a week of inactivity.
- **Per-request overlay design** (hosted mode copies a SQLite template and hydrates the user's state each request): adding tables increases hydrate/extract cost. We will measure after P3 and keep the response under the current numbers; large blobs never go through it (only metadata).
- **Migration safety**: all schema changes idempotent; test on a copy of real data; local backups taken automatically before upgrade (already the pattern).
- **Untested items still open from earlier versions**: Tauri desktop shell and the Windows scripts. They are not part of v0.4 unless you want them.
- **Privacy**: attachments are private by default; no public links unless you add the share feature later.

---

## 10. Acceptance checklist for "done"

- [ ] With S1-S3 done and a start date of today, the timeline shows S1-S3 as history and S4 beginning at the anchor; "behind/ahead" is correct.
- [ ] 25+ scheduling scenarios pass in automated tests.
- [ ] Clicking any card or bar opens the drawer in under 150 ms and the URL is shareable.
- [ ] Notes, subtasks, labels, assignee and attachments persist per user and survive reload, backup and restore.
- [ ] An image pasted from the clipboard is compressed, uploaded, shown, and deleted correctly; another user cannot fetch it.
- [ ] Timeline is usable with mouse, keyboard and touch; no horizontal page scroll at 360 px width.
- [ ] Lighthouse accessibility >= 95; contrast passes in both themes.
- [ ] First-load budget unchanged (±5 KB).
