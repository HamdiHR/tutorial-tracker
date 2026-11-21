# Suggestions for next versions

_Done so far from this list: timeline (0.3), team + task timeline + Scrum board (0.35)._

Ideas only, nothing here is built. Effort: S = hours, M = a day, L = several days. Mark the ones you want and they go into the next version.

## Recommended next (best value for effort)

| # | Idea | Why | Effort |
|---|---|---|---|
| 1 | **Time tracking per ticket** (start/stop timer, auto-pause when idle) | Real estimates for the timeline: planned vs actual time per sprint, and the plan can use your true pace | M |
| 2 | **Daily goal + "today" view** (tickets due today from the timeline, one click to start) | Turns the timeline into a daily routine | S |
| 3 | **Auto re-plan** ("I fell behind": shift the remaining sprints from today with one click) | Plans always drift; this keeps the calendar honest | S |
| 4 | **Weekly review page** (steps done, time spent, edits, notes, badges earned, next week's plan) | Motivation and a record of what you learned | M |
| 5 | **Export progress report** (markdown / PDF per sprint or whole course) | Share with a mentor or keep as portfolio proof | M |
| 6 | **Calendar export (.ics)** of the sprint and ticket due dates | See the plan in Outlook / Google Calendar, with reminders | S |

## Learning features

- **Flashcards / quiz from your notes and verify blocks** (spaced repetition: review what you noted last week).
- **Per-ticket "I'm stuck" log**: a blocker note with date, searchable, and a "stuck for N days" warning on the dashboard.
- **Concept glossary**: select text in a slide, "Add to glossary", browse all terms later.
- **Bookmarks / pinned slides** for commands you keep coming back to (a personal cheat sheet page).
- **Command runner checklist**: mark each code block as "ran it" separately from the step checkbox.
- **Copy all commands of a slide** in one click (joined, comments stripped).
- **Per-step difficulty / confidence rating** (1-5) to find what to revisit.

## Content and editing

- **Side-by-side diff on re-import** for a whole sprint (not just one slide).
- **Add your own slides and tickets** (not only edit existing ones), and reorder them.
- **Image paste into the editor** (stored next to the database, exported with the .md files).
- **Tags and filters** (e.g. `auth`, `ui`, `ops`) with dashboard filters by tag.
- **Link checker for the docs links** in "Verify against docs" blocks, flagging dead URLs.
- **Template for new tutorials**: import a different tutorial folder and keep several courses in one app.

## Dashboard and motivation

- **Course switcher** if you add more than one tutorial.
- **Weekly streak with rest days** (a streak that respects the working days you set in the timeline).
- **Milestone celebrations** at 25 / 50 / 75 % and on the planned finish date.
- **More badges**: early bird / night owl, "fixed 10 upstream errors", "no drift left in a sprint", on-plan streak (N days in a row on schedule).
- **Optional sounds** (off by default).
- **Themes**: accent color picker, plus a high-contrast theme.
- **Focus mode**: hides the sidebar and notes, large type, one step at a time.

## Reliability and quality

- **One-click backup / restore from Settings** (zip with database + content) and an automatic weekly copy to a folder you choose (e.g. OneDrive).
- **Undo for more actions** (deleting a note, resetting a slide) with a short trash bin.
- **Offline-safe save indicator** and a warning if the server stops while you edit.
- **Keyboard-only mode** improvements: shortcuts cheat sheet on `?`, jump to sprint with `g` then a number.
- **Accessibility pass** (screen-reader labels for the calendar, focus order, larger text option).
- **Automated browser tests** for the main flows (slides, edit, bulk, timeline) so updates stay safe.

## Desktop (Tauri)

- **Compile and test the Windows build** (still untested) and produce an installer.
- **Tray icon + start with Windows**, close-to-tray.
- **Native notifications** ("3 tickets due today", "streak ends tonight").
- **Global shortcut** to open the app and jump to Resume.

## Maybe later

- Sync between two computers (copy the database through OneDrive/Dropbox with a safe lock).
- Mobile read-only view on the local network (PIN protected).
- AI helper that explains a slide or error on demand (needs your own API key, off by default).

## Added after v0.35

- **Ticket dependencies**: "T05 needs T02". The auto split then never starts a ticket before its prerequisites finish, even across people.
- **Sprint burndown / burnup chart** and velocity per person (steps per working day).
- **WIP limits** on board columns (e.g. max 3 Ongoing per person) with a warning color.
- **Board per person** ("My tasks" page) and a daily stand-up view: done yesterday, doing today, blocked.
- **Time estimates in hours** instead of steps for the split, learned from tracked time.
- **Shared mode on your office network** (everyone opens the app in a browser and picks who they are).
- **Comments on a card** and a short activity log per ticket (who moved it, when).
- **Custom board columns** and column rules.
- **Auto re-plan from today** that keeps manual changes.
