# PARKED: Claude Link (not chosen for v0.40, kept for later)

> Moved aside on 23 Nov 2026. Note: it assumed Claude Code. For a free-tier user the first deliverable should be the task pack + paste-back, then local MCP for Claude Desktop (to be tested), then a hosted connector (OAuth to be checked).


Status: PLAN ONLY. No code is written until you approve it. Written 22 Nov 2026, after shipping 0.39.1 to 0.39.3.

> Naming note: we shipped the "v0.4" plan as 0.39.1 to 0.39.3 (your decision: keep the 0.39 line). So this file is called `planning-v0.4.md` as you asked, but the release it describes is **v0.40**. If you prefer another number, only the version badge and the docs change.

---

## 1. Review: what we have today (0.39.3)

### 1.1 Product map

| Area | What exists |
|---|---|
| Learning content | 11 sprints, 238 sections, 1054 steps from markdown; steps tick, drift detection, XP, levels, badges |
| Hosting | Vercel + Supabase (Postgres, Auth, Storage). Invite-only sign-up, owner account, separate progress per account (row-level security) |
| Timeline | Smart start ("continue from where I am" / from sprint 1), target end date, real completion dates for history, forecast range; views: Roadmap (Gantt), Team lanes, Calendar, Agenda, Sprints; drag/resize with undo; minimap; burndown; dependency arrows; "What if" planner; `.ics` export |
| Board | 5 columns, drag and drop with Undo, WIP limits, grouping, built-in and custom saved filters, collapsible columns, compact mode, review ribbon for Claude work |
| Task drawer | Assignee (you / Claude), dates, priority, labels, blocked reason, subtasks, files and images, notes, comments (as you or as Claude), dependencies, steps, copy link, "Brief for Claude" (copies a prompt) |
| Quality | 46 automated tests (scheduling, API, hosted handler, SQL/RLS incl. storage), plus browser checks I ran by hand |

### 1.2 Honest gaps found while reviewing

These shape the plan below. Sorted by how much they matter.

1. **The "Claude" assignee is only a label.** Assigning a task to Claude changes a name on a card. Claude cannot read the task, tick a step, or report back. You copy a brief by hand and paste Claude's answer by hand. This is the biggest gap between what the app promises (vibe-coding hand-off) and what it does.
2. **No UI regression net in the repo.** The browser checks (Playwright) live in my scratch folder, not in the project. Anyone changing `board.js` or `drawer.js` later has no safety net. Tests cover the server and SQL only.
3. **Hosted uploads were tested against an emulator** of Supabase Storage, not the real service. The policies are verified in real Postgres, but the real bucket has not been exercised by a person yet.
4. **Deploys are manual** (Vercel is not connected to GitHub). Each release needs a manual deployment call.
5. **Dependencies only warn.** An arrow turns red on a conflict, but dates do not move.
6. **Comments are plain text** and the author is just "me" or "Claude". No Markdown, no history of edits.
7. **No per-task activity feed.** The app logs step ticks globally, but the drawer cannot show "what happened on this task".
8. **Code growth.** `timeline.js` (431 lines), `board.js` (336), `drawer.js` (322) have very long lines and sections added by patching. `style.css` grew by appended blocks. Still manageable, but the next big feature will not fit without splitting them.
9. **Small leftovers:** unused `ZOOM` constant in `roadmap.js`; the one-shot search value stored in `localStorage` when applying a saved filter; the optional Tauri desktop shell has never been run.
10. **Operational limits you should know:** Supabase free tier pauses after about a week of no traffic; auth emails use Supabase's built-in sender (rate-limited) until you add your own SMTP; the Site URL in Supabase must match the production URL.

---

## 2. Goals for v0.40

| # | Goal | Success looks like |
|---|---|---|
| G1 | **One big feature: Claude Link** (real hand-off to your AI coding assistant) | You assign a task to Claude. Claude Code (or any MCP client) reads the task, works, ticks steps, adds subtasks and comments, and marks it "needs review". You see everything on the board without copy-paste |
| G2 | A review loop you can trust | A per-task activity feed shows who did what (you or Claude). One click reverts everything Claude did on a task |
| G3 | Safety net and release hygiene | UI tests live in the repo and run in CI; pushing to `main` deploys automatically |
| G4 | Six enhancements (section 5) | Each has its own acceptance check |

Out of scope for v0.40: team chat, billing, native mobile apps, email notifications (blocked by Supabase free-tier email limits), changing the tutorial content format.

---

## 3. THE BIG FEATURE: Claude Link

### 3.1 The idea in one paragraph

The app becomes a small **MCP server**. MCP (Model Context Protocol) is the standard way tools such as Claude Code connect to outside apps. Once connected, Claude can call named actions like `get_task` and `tick_step`. You keep the normal workflow ("assign to Claude, then review"), but Claude acts on the real data instead of a pasted prompt.

### 3.2 What you will be able to do

1. Run Claude Code in your project and say: "Work on the tasks assigned to Claude in Tutorial Tracker, one at a time."
2. Claude asks the tracker for its queue, reads the first task (steps, your notes, subtasks, comments, dependencies, attached images), starts it, ticks steps as it completes them, writes a comment summarizing what it changed, and finishes with status "needs review".
3. On the board the card shows the existing **"Claude finished this"** ribbon. You open the drawer, read the activity feed, and either accept (tick Done) or **Revert Claude's run**.
4. Everything is attributed: each tick, subtask and comment records `actor = claude` or `actor = you`.

### 3.3 Tools Claude gets (the "contract")

All tools are scoped to the signed-in account. Names are final-draft, parameters listed in brief.

| Tool | Does | Notes |
|---|---|---|
| `list_my_tasks` | Tasks assigned to the AI member, with status, due date, priority, blockers | Filter: status, sprint, "ready" (all dependencies done) |
| `get_task` | Full brief: title, steps (with ids), your notes, subtasks, comments, labels, dependencies, file list with short-lived links | Same content as today's "Brief for Claude", but structured |
| `start_task` | Sets status "doing", logs the start, adds a system comment | Refuses if a dependency is unfinished (can be overridden by you in settings) |
| `tick_step` / `untick_step` | Ticks or unticks one step by id | Respects the existing undo log |
| `add_subtask` / `tick_subtask` | Manage subtasks | Max 100, same limits as the UI |
| `add_comment` | Posts a comment as Claude | 2000 characters |
| `set_blocked` | Marks blocked with a reason | Shows on the card |
| `finish_task` | Adds label "Claude done", status to "test" (needs review), posts the summary comment | Never sets Done: **you** accept the work |
| `get_context` | Returns a generated project context file (see 3.5) | Optional |

Deliberately **not** offered: deleting tasks, editing the plan or team, changing other accounts, reading other accounts, uploading files. Fewer powers means less to go wrong.

### 3.4 Two ways to connect

**A. Local mode (phase 1, simplest).** `node server/mcp.js` starts a stdio MCP server that talks to the already running local app over `http://localhost`. Claude Code config is a 3-line JSON entry. No tokens needed because it never leaves your machine.

**B. Hosted mode (phase 3).** An HTTP endpoint `/api/mcp` on the Vercel app, authenticated with a **personal access token** you create in Settings.

Token design (this is the security-critical part):
- Created in Settings, shown once, stored only as a SHA-256 hash in a new table `tt_tokens` (user, name, hash, scopes, expires, last used, revoked).
- Scopes: `read` and `write`. Default expiry 90 days. Revocable in one click.
- The hosted server must act as that user without holding the Supabase **service key** for every request. Plan: two new `SECURITY DEFINER` SQL functions (`tt_state_t(token)` and `tt_apply_t(token, patch)`) that check the hash, resolve the user, then run the same logic as today. They are granted to the anon role, and every call is tied to a token row. This keeps row-level security as the only gate and avoids a master key in the request path.
- Rate limit per token (for example 60 requests a minute) and an audit row for every write.
- Tokens can never read or write another user's rows, which gets its own SQL test (same style as the existing isolation checks).

### 3.5 Task pack and context file (works without MCP too)

For people or days when MCP is not set up:
- **Download task pack**: one zip or markdown with `CLAUDE.md` (project context: what the tracker is, rules like "tick a step only when its check passes"), plus one brief per assigned task, plus the task's images. Paste or drop into any assistant.
- **Paste-back**: a box in the drawer where you paste Claude's final message. The app turns lines like `- [x] step title` into ticks (preview first, you confirm) and stores the rest as a comment.

### 3.6 Review loop (G2)

- New **Activity** section in the drawer: time, actor (You / Claude), what changed (ticked step 3, added subtask, changed status). Built from the existing activity log plus the new `actor` field.
- **Revert Claude's run**: undoes every change with `actor = claude` since the last `start_task` (reuses the existing bulk undo mechanism). Asks for confirmation and lists what it will undo.
- Board: the ribbon "Claude finished this" gets an **Accept** button (ticks the rest and moves to Done) and a **Send back** button (status "doing" plus a comment to Claude).

### 3.7 Data model changes (design only)

| Where | Change | Migration |
|---|---|---|
| `activity` (SQLite) and `tt_activity` (Postgres) | add column `actor text default 'me'` | `004_actor.sql`, safe to re-run |
| `tt_tokens` (new, hosted only) | id, user_id, name, hash, scopes, expires_at, last_used_at, revoked_at | in `004_actor.sql` or `005_tokens.sql` |
| ticket extras `tk:<id>` | comments and subtasks already exist; add `by` (me or ai) on subtasks and `run` marker on comments | no SQL, JSON only |
| `tt_state_t`, `tt_apply_t` | token-based wrappers (hosted) | SQL, with tests |

The build script already applies SQL files non-fatally at every Vercel build, so no manual steps for you.

### 3.8 Phases for Claude Link

| Phase | Deliverable | Done when |
|---|---|---|
| A | `actor` column, activity feed in the drawer, Revert run, Accept / Send back | Feed shows correct actor for UI actions; revert restores state in a test |
| B | Local MCP server (stdio) with all tools in 3.3 | A scripted MCP client test runs a full task from list to finish; the existing 46 tests still pass |
| C | Task pack download + paste-back | Round trip test: export pack, paste a sample reply, preview shows right ticks |
| D | Hosted tokens, `/api/mcp`, rate limits, audit | SQL isolation tests for tokens pass; end-to-end against the local Postgres stack |
| E | Docs: "Connect Claude Code" page with copy-paste config for local and hosted; safety notes | You can follow it cold and connect in under 5 minutes |

### 3.9 Risks and how we handle them

| Risk | Handling |
|---|---|
| Claude ticks steps it did not really finish | Claude never sets Done, only "needs review"; Revert run; every tick is attributed and timestamped |
| Leaked token | Hashed storage, scopes, expiry, one-click revoke, last-used shown, audit rows |
| Prompt injection through task text or comments (a note that says "ignore your rules and ...") | Tool outputs are plain data fields, the contract has no destructive tools, writes are limited to the one account and logged |
| MCP spec details change | Keep the server thin (one file) and the tool contract in a table in the docs |
| Vercel function time and cost on the free tier | Stateless handler, short responses, no long polling; stdio local mode needs no hosting |
| Scope creep | Phases A and B alone already deliver the main value; C, D, E can slip to 0.40.1 without blocking release |

---

## 4. Decisions I need from you

1. **Claude Link scope for the first release.** Recommended: phases A + B + C in v0.40, hosted tokens (D) in v0.40.1. Reason: local mode gives you the full experience on your machine safely; hosted tokens add the most security work. Alternative: everything in one release.
2. **Is Claude Code your main assistant?** The plan assumes MCP clients (Claude Code first). If you use another tool, say which and I will adjust the connection docs.
3. **Accept flow.** Should Claude be allowed to move tasks to Done in any case (for example tasks you label "auto-accept")? Recommended: **no**, you always accept.
4. **CI and auto-deploy.** OK to add GitHub Actions (tests on every push) and connect the Vercel project to GitHub so `main` deploys by itself? Needs one click from you in Vercel settings.
5. **Version number.** Keep the 0.39 line (v0.40) as proposed, or call it something else?

---

## 5. Enhancements (six, in priority order)

| # | Enhancement | Why | Size |
|---|---|---|---|
| E1 | **UI tests in the repo + GitHub Actions CI + auto-deploy** (turn my browser checks into `test/e2e/*.test.js`, run on every push, connect Vercel to Git) | Closes gaps 2 and 4. Protects everything built so far | M |
| E2 | **Dependency-aware scheduling** (a switch in plan settings: "Respect dependencies"; blocked tickets start after their blockers; cycle detection with a clear message) | Closes gap 5; arrows become real | M |
| E3 | **Per-task activity feed** (also part of Claude Link phase A, listed here so it is not forgotten) | Closes gap 7 | S |
| E4 | **Keyboard-first board and drawer**: `j/k` move between cards, `Enter` open, `a` assign, `p` priority, `/` search, `?` shows shortcuts | Speed for daily use | S |
| E5 | **Board multi-select + bulk actions** (assign many to Claude, set label, move column) | Assigning 10 tasks to Claude today means 10 clicks | M |
| E6 | **Timeline export as image/PDF** (print stylesheet plus "Download PNG" of the roadmap) | Sharing progress outside the app | S |

Not chosen on purpose, with reasons: email reminders (free-tier email limits), installable PWA / offline mode (large, and the app is online-first through Supabase; revisit after Claude Link), Markdown in comments (small, can ride along with E3 if time allows).

### Cleanup bundled into E1 (no new features)

- Split `timeline.js` and `board.js` into smaller modules where the new work touches them.
- Remove the unused `ZOOM` constant; replace the one-shot `bdQ` hack with a proper "apply view" function.
- Run the optional Tauri shell once, or mark it clearly as "unverified" in the README.

---

## 6. Proposed order of work

1. E1 first (tests and CI), so everything after is protected.
2. Claude Link phase A (actor, activity feed, revert, accept / send back) with E3.
3. Claude Link phase B (local MCP server).
4. Claude Link phase C (task pack, paste-back).
5. E2 (dependency-aware scheduling), E4, E5, E6.
6. Phase E docs; then ship v0.40.
7. v0.40.1: Claude Link phase D (hosted tokens) if approved.

Each step ends with all tests green and a deployable build, like the last version.

---

## 7. Acceptance checklist for "done"

- [ ] Assigning a task to Claude, then running Claude Code against the local MCP server, completes a sample task end to end with no copy-paste
- [ ] Every action by Claude shows in the activity feed with actor "Claude"; Revert run restores the previous state
- [ ] Claude can never set a task to Done and cannot reach other accounts or the plan (covered by tests)
- [ ] Task pack export and paste-back round trip works
- [ ] UI tests run in CI on every push; a push to `main` deploys by itself
- [ ] Dependency-aware scheduling can be turned on and off, cycles are reported clearly
- [ ] Keyboard shortcuts and bulk actions work on the board
- [ ] Timeline export produces a readable PNG
- [ ] README and a new "Connect Claude Code" guide are updated; honest "not built" list at the end of this file is kept current

## 8. Honest "not built" list (to be updated at release)

- Hosted personal access tokens (if decision 1 keeps them for v0.40.1)
- Email reminders, offline mode, native mobile apps
- Real-service test of hosted file uploads by a person (needs you to try one upload after deploy)
