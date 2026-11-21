# Tutorial Tracker

A small, fast local app for following long step-by-step tutorials (your 11 sprint `.md` files) without getting lost.

- **Dashboard**: "Continue where you left off", level card, overall progress, one course card per sprint (ring, ticket tiles, Start / Continue / Review), streak, recent edits.
- **Timeline**: answer a few questions (start date, **team size**, sprint length, working days, days off) and get a dated calendar. Switch between a **Sprints** view and a **Tasks** view (every ticket as a bar, one lane per person, drag to re-date or reassign). Plan-vs-actual check, projected finish, team workload, "due by today".
- **Board**: Scrum board with Pending, Ongoing, Done, Blocked and Test & fixes. Drag cards between columns; Done ticks every step; the last ticked step moves a ticket to Done by itself. Filter by sprint or person, group by sprint.
- **Manage progress**: tick or reset many tickets, whole sprints, or everything at once, with a confirmation and an Undo.
- **Achievements**: levels and XP, 10 tiered badges (Bronze to Diamond) and a trophy per completed sprint.
- **Motion**: slide transitions, animated rings and bars, confetti when you finish a ticket, a sprint, or earn a badge (all switched off automatically if your OS has "reduce motion" on).
- **Slides**: every ticket is a deck, every `###` step is a slide, the `✅ Verify` block is the last slide. Copy button on every code block.
- **Edit anything**: fix a command, add a line. Every edit is versioned (diff + restore + reset to original).
- **Notes**: one markdown note per slide and one per ticket.
- **Search** (`Ctrl K`) across all slides and notes, **Drift inbox** for every "🔍 Verify against docs" spot.
- **Re-import safely** when the tutorial files change: your edits, notes and progress are kept.

Runs on plain Node. **No `npm install` needed** to use it (the UI is prebuilt in `public/`).

## Run it (Windows)

1. Install **Node.js 22.13 or newer** (https://nodejs.org).
2. Unzip to a short path, e.g. `C:\dev\tutorial-app`.
3. Double-click **`start.cmd`**. The browser opens on http://localhost:4173.

First start imports the 11 files in `content\` (a few hundred milliseconds). Your data lives in `data\tutorial.db`.

| File | What it does |
|---|---|
| `start.cmd` | Starts the server with a console window and opens the browser |
| `start-hidden.vbs` | Starts it in the background, no window |
| `stop.cmd` | Stops whatever listens on port 4173 |

Another port: `set PORT=5000` before `start.cmd`.

## Keyboard

`←` `→` previous / next slide · `Space` mark slide done · `[` `]` previous / next ticket · `E` edit · `N` notes · `Ctrl K` search · `Esc` close dialog · in the editor `Ctrl S` saves, `Tab` indents.

## How progress works

- Each step (and the Verify slide) has a checkbox. **Ticket status is derived**: none checked = To do, some = In progress, all = Done, so every number in the app always agrees.
- The status dropdown on a ticket: *Mark all steps done* ticks every step, *Reset all steps* clears them, *In progress* / *Blocked* are manual labels, *automatic* goes back to derived. Both bulk choices offer Undo.
- **Manage progress** (sidebar) does the same for many tickets or whole sprints at once. Bulk actions don't count toward your streak or "steps in a day" badges.
- The Overview slide and reference sections (Git workflow, Troubleshooting…) are read-only and not counted.
- Sprint 0's three setup sections (Windows + Cmder, Prerequisites, Step 0) are tracked as `S0-P1…P3`.
- Tickets marked DEFERRED are shown but excluded from the totals.

## Board

Open **Board**. Columns are the ticket status: **Pending** (not started), **Ongoing**, **Done**, **Blocked**, **Test & fixes**. Drag a card, or use the ⇄ menu on the card (works on touch screens too). Rules:
- Drop on **Done** = every step is ticked (an Undo appears). Ticking the last step of a ticket on the ticket page moves it to Done on its own, whatever column it was in.
- Drop on **Pending** keeps the steps you already ticked (nothing is lost). Ticking a new step takes it out of Pending.
- Ongoing, Blocked and Test & fixes are labels; they never change your steps.
- Cards show the owner (click the avatar to reassign), the planned due date (red when late), progress, notes and edits.

## Team and the timeline

In the timeline form, set **how many people** work on it (up to 12), name them, and optionally give each person their own working days and days off. Tickets are split automatically, balanced by workload (steps per available day), in tutorial order, and each person's tickets are spread over their own days. In **Tasks** view each person has a lane; drag a bar sideways to change its dates, drop it on another lane to reassign (Undo is offered), or click it for details. Your manual changes are marked 📌 and survive re-planning; "Reset manual changes" returns to the automatic split.

## Timeline

Open **Timeline** in the sidebar. The first time it asks: when sprint 1 starts, how long each sprint takes (working days or weeks), which weekdays you work, and any days off. It spreads each sprint's tickets across its working days, so every ticket gets a due date. "Edit plan" changes any answer and the calendar is recalculated instantly; your progress is never affected. The plan is stored in the database, so it is included in backups.

## Levels, XP and badges

XP: 10 per step, 50 per ticket, 250 per sprint, 10 per slide you fix, 5 per note or verified drift item. Ten badge families have Bronze/Silver/Gold(/Platinum/Diamond) tiers (steps, tickets, sprints, overall %, streak, steps in a day, fixes, notes, drift items, inbox zero), plus a 🏆 per completed sprint. Badges are never taken away if you reset progress later.

## Updating the app itself

Unzip the new version **over** your existing folder (keep your `data\` folder; the zip does not contain one). On first start it makes a backup, upgrades the database, and any ticket that was marked Done the old way gets all its steps ticked. Badges you had already earned appear silently, without a celebration.

## Updating the tutorial files later

Drop the new `sprint-XX-tutorial.md` files into `content\` and open **Settings → Re-import** (or `npm run import`). Matching is by ticket ID + step heading:

- slides you never edited → updated to the new text
- slides you edited → **your text is kept**, flagged "↯ upstream changed" with a diff; choose *Keep mine* or *Accept upstream*
- new steps are added; steps removed upstream are dropped unless you touched them (then flagged)
- progress, notes and drift decisions are never touched; a backup is taken first

## Export back to markdown

**Settings → Export** writes clean `.md` files (to `export\`) or downloads one sprint. An unedited export is byte-identical to the original files (this is covered by a test).

## Data and backups

`data\tutorial.db` is one SQLite file. A snapshot is saved to `data\backups\` on every start and before every import (last 5 kept). To restore: stop the app, copy a backup over `tutorial.db`.

## Desktop window (Tauri)

See `desktop/README.md`. It is a thin window around the same server, so browser and desktop show identical data. **This part is written but not yet compiled or tested** (the crates could not be downloaded where it was prepared).

## Developing

```
npm install        # only needed to rebuild the UI (esbuild, marked, highlight.js)
npm run build      # web/src -> public/assets (code-split, hashed, pre-compressed br/gz)
npm run build:single  # old one-file bundle (public/app.js), fallback for very old WebViews
npm test           # parser, merge, bulk, badges, API and security tests (no install needed)
```

Layout: `server/` (Node http + `node:sqlite`, no dependencies), `web/src/` (vanilla JS modules), `public/` (built UI, committed), `content/` (your tutorials), `desktop/` (Tauri shell).

The server only listens on `127.0.0.1`, rejects unknown Host headers (DNS-rebinding) and cross-origin or non-JSON writes.

## Troubleshooting

- **"Port 4173 is already in use"**: the app is already running; just open http://localhost:4173, or run `stop.cmd`.
- **`ExperimentalWarning: SQLite`** in a console: harmless; the start scripts hide it.
- **Slides look unhighlighted / old after updating**: hard-refresh with `Ctrl F5`.


## Performance (v0.37)

- The first screen loads about 80 KB of JavaScript/CSS (about 23 KB brotli). Markdown, syntax highlighting, board, timeline and ticket views load on demand.
- Code blocks show as plain text first and are highlighted only when scrolled near, in idle time. Copy gives instant feedback.
- Static files and JSON are compressed (brotli/gzip), cached by content hash, and revalidated with ETag/304.
- Board shows 30 cards per column (Show more), uses one shared menu, and moves cards in place with one request.
- Settings > Performance log lists any slow moment (long task, slow click, slow copy) measured on your machine. It stays local.
- `node scripts/perf-baseline.cjs [cpuSlowdown]` re-runs the measurements (needs Playwright and a saved plan).

### Hosting on Vercel

See `HOSTING.md` (v0.39): Vercel + Supabase Postgres, email/password sign-in, invite-only, per-person progress. The local app and desktop shell are unchanged.

## v0.39 - Hosted version

Vercel + Supabase, email/password sign-in (invite-only), per-person data, first-login question (start from zero or from a ticket, optionally marking everything before it as done), owner invites in Settings. Setup: `HOSTING.md`.
