# Planning: next version (release name **v0.40**) - Offline-first installable app (PWA) with sync

Status: PLAN ONLY. No code is written until you approve it. Written 23 Nov 2026, after shipping 0.39.1 to 0.39.3.
You chose the big feature: **Offline-first installable app (PWA) with sync**. Claude Link is parked (see `parked-claude-link.md`).

> Naming: the release is **v0.40** (we shipped the previous "v0.4" plan as 0.39.x). Tell me if you want another number.

---

## 1. Review: what we have today (0.39.3)

| Area | What exists |
|---|---|
| Learning content | 11 sprints, 238 sections, 1054 steps from markdown; ticks, drift detection, XP, levels, badges, full-text search |
| Hosting | Vercel + Supabase (Postgres, Auth, Storage). Invite-only, owner account, separate progress per account via row-level security |
| Timeline | Smart start, target end date, forecast, Roadmap (Gantt), lanes, calendar, agenda, sprints, minimap, burndown, dependency arrows, "What if" planner, `.ics` export |
| Board | Drag and drop with Undo, WIP limits, grouping, built-in and custom saved filters |
| Task drawer | Assignee (you / Claude), dates, priority, labels, subtasks, files, notes, comments, dependencies, steps, copy link |
| Quality | 46 automated tests (server, scheduling, hosted handler, SQL and storage isolation) |

### 1.1 How the hosted app works today (this decides the PWA design)

Every request goes: browser -> Vercel function -> (1) verify the person, (2) download **their** saved state from Postgres in one call (`tt_state`), (3) copy the shipped tutorial database (`content.db`, 6.8 MB) to a temporary SQLite file, (4) pour the person's state on top (`hydrate`), (5) run the normal engine (`createApi`: scheduling, XP, badges, search), (6) compare before and after (`extract` + `diff`) and (7) save only the differences in one call (`tt_apply`).

Consequences for offline:
- **Good news:** steps 3 to 6 are already pure "database in, database out". If SQLite can run **in the browser**, the same tested engine can run on the phone with no network. Nothing has to be rewritten twice.
- **Constraint 1:** the engine uses Node's built-in `node:sqlite`. Browsers have no SQLite, so we need a small WebAssembly build of it (about 1 MB). That is a **new dependency**.
- **Constraint 2:** `tt_apply` today is "last write wins" per row, with no version numbers and **no protection against being replayed twice**. Activity and version history rows are plain inserts, so a retried upload would duplicate them. Sync needs idempotency (an operation id) before anything else.
- **Constraint 3:** my workspace cannot install npm packages right now (network access is off for installs). The WASM library must be added either by allowing installs in your settings (new chat) or by you supplying the file. Vercel builds can install it normally.

### 1.2 Honest gaps found while reviewing (they shape this plan)

1. **No UI tests in the repo.** My browser checks live in my scratch folder. A service worker is the easiest thing to break silently, so this must be fixed first (enhancement E1).
2. **Hosted uploads were tested against an emulated Supabase Storage**, not the real one. Please try one upload after the next deploy.
3. **Deploys are manual** (Vercel is not connected to GitHub).
4. **Per-task activity feed is missing**, which sync diagnostics will need.
5. **Code growth:** `timeline.js`, `board.js`, `drawer.js` are large with very long lines; `style.css` grew by appended blocks. The data layer swap touches `web/src/api.js`, so we split only what the new work touches.
6. **Operational limits you should know:** Supabase free tier pauses after about a week without traffic (offline-first actually helps here: the app keeps working while the database sleeps); auth emails use the built-in sender; the Site URL in Supabase must match the production URL.

---

## 2. Goals for v0.40

| # | Goal | Success looks like |
|---|---|---|
| G1 | **Installable app** | "Install" works on Android/desktop Chrome/Edge and "Add to Home Screen" on iPhone; opens full screen with its own icon |
| G2 | **Works fully offline** | Airplane mode: open the app, see the board, timeline, search, read slides, tick steps, edit notes and tasks, add comments, change the plan. Everything computes locally (same engine, same results as online) |
| G3 | **Safe sync** | Reconnect and your changes upload by themselves, once, in order. Two devices do not lose each other's work; real conflicts are shown, never silently dropped |
| G4 | **Clear status** | A small status chip: Synced / Syncing / N changes waiting / Offline / Needs attention |
| G5 | **Safety net** | UI tests (including offline and two-device scenarios) in the repo, run on every push; `main` deploys itself |
| G6 | Five enhancements (section 7) | Each has an acceptance check |

Out of scope: native apps, push notifications, offline file **downloads** of everything, real-time collaboration between different people, changing the content format.
Desktop/local mode (Node server) is **unchanged**: it is already local.

---

## 3. Architecture decision

### 3.1 Options compared

| | A. Same engine in the browser (**recommended**) | B. Cache + queue (lighter) |
|---|---|---|
| Idea | Run SQLite (WASM) + the existing `createApi` inside a Web Worker. The browser keeps a local copy of your state; sync pushes the same `diff` format the server already uses | Service worker caches pages and API reads; writes wait in a queue; the UI patches itself optimistically |
| Offline reads | Everything: schedule, XP, badges, search, burndown | Only what was fetched before; derived numbers are stale |
| Offline writes | Any action, with correct results immediately | Only a short list of simple actions (tick, note, status); anything computed server-side is wrong until sync |
| Duplicated logic | None | Must re-implement scheduling, XP and badges for the client (drift risk) |
| Cost | WASM dependency, bundling the engine for the browser, start-up time | Smaller, but permanently partial |
| Main risk | Start-up time and SQLite features (full-text search) in WASM | "Why does my phone show different numbers than my laptop?" |

**Decision gate (phase 0 spike, 1 to 2 days):** prove option A works before committing. Pass criteria: (1) the WASM SQLite runs `content.db` including full-text search (FTS5); (2) hydrate plus the overview call finishes in **under 1.5 s on a mid-range phone profile** after the first visit; (3) the engine bundle runs in a Worker with the Node-only bits shimmed. **If it fails, we fall back to B-lite** (read-only offline plus queued simple writes) and tell you before spending more time.

### 3.2 Components

```
Browser tab (UI, unchanged screens)
   |  api.js  (same functions, now calls the local engine)
   v
Web Worker "engine"  <-- SQLite WASM + content.db (cached) + createApi (shared code)
   |  after every change: extract/diff -> update local state store + outbox
   v
IndexedDB:  state (the tt_state-shaped JSON, small)  |  outbox (ordered ops)  |  blobs (queued uploads)  |  meta (versions, last sync)
   |
Sync manager (main thread, one tab leads): push outbox -> tt_apply_v2, pull state -> rebase
   |
Supabase (unchanged tables + 1 new table + 1 new function)
```

- **What is stored locally:** not the 6.8 MB database (that is a cached, versioned, read-only asset), only the person's **state JSON**, which is what `tt_state` returns today (a few KB to a few hundred KB). On start the worker loads the cached `content.db`, runs `hydrate`, and the engine is ready. This is exactly what the server does per request, so behavior matches.
- **Service worker** caches the app shell (JS, CSS, icons, WASM, `content.db`) with a build-hash version, and serves it offline. It never caches API responses or signed file links.
- **Single owner:** with several tabs open, one tab owns the worker (Web Locks API); others talk to it through a broadcast channel.

### 3.3 Sync protocol (the heart of the feature)

**Outbox.** Each local change produces a diff (existing format) plus an **operation id** (UUID) and a client timestamp. Operations are stored in order and removed only after the server confirms them.

**Push.** New SQL function `tt_apply_v2(p jsonb, op_id uuid)`:
- records `op_id` in a new table `tt_ops(user_id, op_id, applied_at)` and returns "already applied" if it was seen, so retries never duplicate activity or history;
- keeps today's logic for the data itself;
- adds a `rev` counter to the user rows it touches, returned to the client.

**Pull.** `tt_state` stays as is (full state; it is small). The client pulls after a push, at app start, on "online", and when the tab becomes visible again.

**Rebase.** After a pull, the worker rebuilds its database from the server state and **replays any operations still in the outbox** on top. This is the same idea as `git rebase` and keeps the UI consistent while offline edits wait.

**Conflicts (two devices edit the same thing while apart).** Policy by field type, decided so nothing is lost silently:

| Kind of data | Rule |
|---|---|
| Different rows (different steps, different tasks) | Both kept, no conflict |
| Checkbox or status (step done, status override) | Newest timestamp wins; both devices converge |
| Text (step notes, task notes, step edits) | If both changed since the last sync, keep the newest as the value and save the other as a **"Conflict copy"** appended to the note, with a banner "1 conflict resolved, review" |
| Plan and per-task extras (JSON blobs such as `plan`, `tk:<id>`) | Newest wins per blob, with a conflict copy kept in a small "Sync log" you can open |
| Append-only (activity, history, badges) | Always merged, deduplicated by operation id |

**Clock problem.** Phone clocks can be wrong. Use the server time returned at each sync to compute the device's offset and correct timestamps; reject operations dated far in the future.

### 3.4 Authentication offline

- The Supabase session lives in the browser; access tokens last 1 hour and refreshing needs the network.
- Offline we **trust the cached session for local access** (the data is already on the device) and never sign you out because a refresh failed offline. Sign-out only happens on an explicit action or a real "invalid session" answer from the server.
- On sign-out we **wipe the local database**. A "Keep me signed in on this device" choice (default on for installed app) controls this.
- Data on the device is **not encrypted** (browser storage). Documented clearly; use a device lock. Encrypting with a passphrase is a possible later item.

### 3.5 Files and images offline

- Uploads made offline are stored as blobs in IndexedDB, shown immediately from the blob, and uploaded when online (compression to WebP already happens in the browser).
- Viewing: thumbnails and images you opened are cached (size cap, for example 50 MB, oldest removed first). Others show a placeholder offline. No promise of full offline file access.

### 3.6 Platform realities (stated up front)

| Platform | What to expect |
|---|---|
| Android Chrome, desktop Chrome/Edge | Full install, background sync possible |
| iPhone/iPad Safari | Add to Home Screen works; **no Background Sync**, so sync runs when the app is opened or regains connection. Websites that are not installed can lose stored data after about a week unused (installed ones are protected). We request persistent storage and show a hint to install |
| Firefox desktop | Works as a website with offline support; no "install" |
| Private/incognito windows | Storage is temporary; the app warns |

---

## 4. Data and SQL changes (design only)

| Where | Change | Migration |
|---|---|---|
| `tt_ops` (new) | `user_id uuid, op_id uuid, applied_at timestamptz`, primary key `(user_id, op_id)`; row-level security by user; old rows purged after 30 days | `004_sync.sql` (safe to re-run, applied at every Vercel build like 003) |
| `tt_apply_v2(p, op_id)` (new) | idempotent wrapper around the current logic; returns `{ok, applied, rev}` | same file; old `tt_apply` stays for local compatibility |
| `tt_user_*` rows | add `updated_at` (set by the function) so conflicts can be detected | same file |
| IndexedDB schema | stores `state`, `outbox`, `blobs`, `meta`; version number with upgrade steps | client only |

SQL tests added: replaying the same operation twice changes nothing; one user cannot see or replay another user's operations; conflict detection returns the right rows.

---

## 5. Install and app experience

- Web app manifest (name, short name, colors, icons 192/512 and maskable, `display: standalone`, start URL, shortcuts to Board and Timeline).
- Icon set generated from the existing logo.
- **Install prompt:** a small, dismissible "Install the app" button in the sidebar (Chrome/Edge) and a short "Add to Home Screen" guide for iPhone.
- **Updates:** when a new version is deployed, the app shows "New version ready - Reload" (never reloads in the middle of an edit). The service worker version is tied to the build hash so old caches are cleaned.
- **Offline-aware screens:** upload buttons say "will upload when online"; the invite and password-reset screens explain they need a connection.
- **Status chip** in the sidebar next to the version badge; clicking opens a **Sync panel**: last sync time, waiting changes (list), conflicts to review, "Sync now", "Export my data (JSON)", "Reset this device's copy" (re-downloads from the server; asks first if changes are waiting).

---

## 6. Phases

Each phase ends with all tests green and a deployable build. Sizes: S about 1 day, M about 2 to 3 days, L about 4 to 6 days.

| Phase | Deliverable | Size | Done when |
|---|---|---|---|
| **0. Spike + gate** | WASM SQLite runs `content.db` with FTS5 in a Worker; adapter for the `node:sqlite` calls the engine uses; measured start-up on a throttled phone profile | M | Pass criteria in 3.1 met, or fallback B-lite chosen and agreed with you |
| **1. Safety net (E1)** | Browser tests moved into the repo and wired to CI; Vercel connected to GitHub for auto deploy | M | CI green on every push; a push to `main` deploys |
| **2. Installable shell** | Manifest, icons, service worker caching the shell, install prompt, update flow, offline page for first-time visitors | M | Lighthouse "installable" passes; app opens offline after one visit |
| **3. Local engine** | Engine in a Worker behind `api.js`; state and outbox in IndexedDB; hydrate on start; all existing screens work against it in hosted mode (online still pushes immediately) | L | The full existing test set passes against the local engine; results identical to the server engine on a recorded scenario |
| **4. Sync** | `004_sync.sql`, idempotent push, pull and rebase, conflict policy, clock correction, status chip, Sync panel | L | Two-device and kill-the-network tests pass (section 8) |
| **5. Offline files + polish** | Queued uploads, cached thumbnails, storage quota handling, persistent storage request, multi-tab ownership | M | Upload offline then reconnect works; two tabs do not corrupt state |
| **6. Enhancements + docs** | Section 7 items, README and a short "Using offline" guide, honest "not built" list | M | Acceptance checklist (section 9) |

Total: roughly 4 to 5 weeks of work if the spike passes. Phases 0 to 2 alone already give an installable app with a read-only offline shell, which is a useful stopping point.

---

## 7. Enhancements (five)

| # | Enhancement | Why | Size |
|---|---|---|---|
| E1 | **UI tests in the repo + GitHub Actions CI + auto deploy** (includes offline and two-device test helpers) | Required to build the PWA safely; closes gaps 1 and 3 | M |
| E2 | **Per-task activity feed** in the drawer (who/what/when) | Closes gap 4; shows synced vs pending changes and conflict copies | S |
| E3 | **Data export and backup**: "Export my data (JSON)" and "Import" in the Sync panel | A safety valve for any sync problem; also a clean way to move accounts | S |
| E4 | **Keyboard-first board and drawer** (`j/k`, `Enter`, `/`, `?` help) | Daily-use speed on desktop | S |
| E5 | **Timeline export as image/PDF** | Share progress outside the app | S |

Not chosen on purpose: email reminders (free-tier email limits), push notifications (iPhone and permission complexity), Claude Link (parked), dependency-aware scheduling (next candidate).

---

## 8. Testing strategy

| Layer | What |
|---|---|
| Unit | Sync rules (conflict policy per field type), outbox ordering, clock correction, operation ids |
| SQL (real Postgres, as now) | `tt_apply_v2` idempotency, isolation between users, `tt_ops` purge, row-level security for the new table |
| Engine parity | Replay a recorded scenario (ticks, edits, plan changes) through the server engine and the browser-WASM engine; compare `overview`, `plan`, XP and badges; must be equal |
| Browser (Playwright, supports service workers and offline mode) | Install state; first load online then **offline reload works**; tick/edit/comment/plan offline; reconnect syncs once; **kill the network in the middle of a push** and retry without duplicates; **two browser contexts as two devices**: edit apart, reconnect, converge; conflict banner appears for same-note edits; sign-out wipes data; update banner on new version |
| Manual (needs you) | One real iPhone and one Android check at the end; one real upload against live Supabase Storage |

---

## 9. Risks and how we handle them

| Risk | Handling |
|---|---|
| WASM SQLite lacks a needed feature (FTS5) or is slow to start | Phase 0 gate; fallback B-lite; start-up can show last known overview from IndexedDB while the engine boots |
| Data loss from a sync bug | Idempotent operations, outbox kept until confirmed, "Conflict copy" instead of overwrite, JSON export (E3), server state is never deleted by the client except through normal operations |
| Service worker serves stale code | Build-hash versioning, "New version ready" flow, a kill-switch (the worker unregisters itself if a special version file says so) |
| Wrong phone clock | Server-time offset correction, reject far-future timestamps |
| iPhone storage eviction | Install guidance, persistent storage request, "last synced" visible, server remains the source of truth |
| Shared-device privacy | Wipe on sign-out, clear wording about unencrypted local storage |
| Bigger first download (content.db about 1.5 to 2 MB compressed plus about 1 MB WASM) | Cache after first visit; show a one-time "Preparing offline mode" progress; Vercel serves compressed |
| Scope creep | Phases 0 to 2 are a complete stopping point; phases 5 and 6 can slip to 0.40.1 |

---

## 10. Decisions (recorded 24 Nov 2026)

| # | Question | Your decision |
|---|---|---|
| 1 | Spike first (phase 0 gate, fallback B-lite)? | **Yes, spike first** |
| 2 | How to get the WASM SQLite library | **Allow package installs and start a new chat** (action for you: turn on network access for package installs in settings, then open a new chat) |
| 3 | Conflict policy | **Newest wins + visible "Conflict copy" for text** |
| 4 | Auto deploy | **Yes, connect Vercel to GitHub** (action for you: one click in Vercel, I will say where; CI runs tests first) |
| 5 | Devices | **Android phone + Windows laptop** (so: Chrome/Edge install and Android background sync are the priority; iPhone checks drop to "best effort") |
| 6 | Version name | **v0.40** |

What this changes in the plan: phase 5 and the platform table focus on Android Chrome and Windows Chrome/Edge; the iPhone guidance stays in the docs but is not tested by hand. Phase 0 cannot start until package installs work in the next chat.

## 11. Acceptance checklist for "done"

- [ ] The app installs on desktop and phone and opens full screen with its icon
- [ ] After one online visit, airplane mode: open, browse board/timeline/search/slides, tick steps, edit notes and tasks, add comments, change the plan, all with correct computed results
- [ ] Reconnect uploads changes once; killing the network mid-sync and retrying causes no duplicates
- [ ] Two devices edited apart converge; same-text conflicts produce a visible Conflict copy and a banner
- [ ] Sign-out wipes local data; "Reset this device's copy" works; JSON export and import work
- [ ] Queued image upload works offline and completes on reconnect
- [ ] Status chip and Sync panel show accurate states
- [ ] New deployments show "New version ready" and never reload during editing
- [ ] UI tests (including offline and two-device) run in CI on every push and `main` deploys by itself
- [ ] Engine parity test passes; all existing 46 tests still pass; new SQL tests pass
- [ ] README and "Using offline" guide updated; the "not built" list below is current

## 12. Honest "not built" list (updated at release)

- Native apps, push notifications, email reminders
- Full offline access to every uploaded file (only opened/queued ones)
- Local-data encryption with a passphrase
- Real-time collaboration between different people
- Claude Link (parked in `parked-claude-link.md`)


---

## 13. Delivery status (updated as we go)

| Phase | Status |
|---|---|
| 0. Spike (WASM SQLite) | **Blocked**: package installs were still refused in the chat of 24 Nov (npm registry unreachable). Needs a new chat after the setting is on, then `npm view sql.js` must work |
| 1. Safety net | **Done in 0.39.4**: 9 browser tests live in `test/e2e` (`npm run test:e2e`), CI workflow `.github/workflows/ci.yml` (unit + hosted SQL on a Postgres service + browser tests). Auto deploy: waiting for you to connect Vercel to GitHub |
| 2. Installable shell | **Done in 0.39.4**: manifest, icons (incl. maskable), generated service worker, Install button, "new version ready" banner, offline notice, session survives a dropped connection |
| 3 to 6 | Not started (3 and 4 depend on the spike) |
