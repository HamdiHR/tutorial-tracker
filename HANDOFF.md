# HANDOFF: Tutorial Tracker (state at 24 Nov 2026, version 0.39.4, release v0.40 in progress)

Read this first in a new chat. It tells a fresh Claude session everything needed to continue without the old conversation.

> **How to start the next chat:** attach `tutorial-tracker-handoff-0.39.4.zip` (or point to the GitHub repo below) and say:
> *"Continue the Tutorial Tracker project. Read HANDOFF.md and planning-v0.4.md first, then do the next step in section 9."*
> Do NOT just say "start spike": a new chat has no memory of the old one.

---

## 1. What the project is

**Tutorial Tracker**: a personal app to follow step-by-step tutorials (11 sprints, 238 sections, 1054 steps from markdown), plan a timeline, run a Kanban board, and track progress with XP/badges.
- Runs **locally** (Node >= 22.13, built-in `node:sqlite`, vanilla-JS UI bundled by esbuild) and **hosted** (Vercel serverless + Supabase Postgres/Auth/Storage).
- Hosted mode: invite-only sign-up, each account has separate progress (row-level security).
- Optional Tauri desktop shell exists in `desktop/` (never run/verified).

## 2. Where everything lives

| Thing | Value |
|---|---|
| GitHub repo | `HamdiHR/tutorial-tracker`, branch `main`, https://github.com/HamdiHR/tutorial-tracker |
| Latest commit | `37a9f576fdbc297b99fefc6225c8d9ac39508d5c` ("v0.39.4: installable app shell (PWA), offline-safe sign-in, browser tests in repo + CI") |
| Production URL | https://tutorial-tracker-livid.vercel.app |
| Vercel project | `tutorial-tracker`, id `prj_EMAHzEvbOHnTshLkQBG0YDSK96og` |
| Vercel team | `team_8ZnO0j3caRWFV7E2M7D2vWeS` (user `hamdihr`) |
| Last deployment | `dpl_CPE2bFQHWSqRroyrsp5XmSMnrZ2B` (production, from the commit above) |
| Supabase project URL | `https://dnctdewfkhktutkgmvlj.supabase.co` (the publishable key is public, served by `/api/config`) |
| Owner account | email `hamdirahal@gmail.com` (role owner). The first password was given to the user in the old chat; they were told to change it and delete the Vercel env var `OWNER_BOOTSTRAP_PASSWORD` |
| Local working copies (old container, may be gone) | `/home/claude/tutorial-app` (working tree) and `/home/claude/tutorial-tracker` (git clone used for pushing) |

### Secrets: NOT in this file or the zip
No passwords or service keys are written here on purpose. They live in **Vercel project environment variables** (names only):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`, `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` (used by the build migration), `OWNER_EMAIL`, `OWNER_BOOTSTRAP_PASSWORD` (should be deleted), `APP_TZ=Africa/Tunis`, optional `SITE_URL`.
Do not print env values. If a value is needed, ask the user.

### How a new Claude session gets access (tools, not tokens)
- **GitHub:** `mcp__github__*` tools (get_me, create_or_update_file, push_files, ...) and plain `git push` from a clone. In the old session `git push` to `origin` worked from the clone through the sandbox proxy. If no clone exists: `mcp__claude-code-remote__add_repo` with owner `HamdiHR`, repo `tutorial-tracker` (access `push`), then clone as it instructs, then `register_repo_root`.
- **Vercel:** `mcp__Vercel__*` tools (load with ToolSearch). Vercel is **not** Git-connected yet, so **deploys are manual** (see section 6). The user agreed to connect it (Vercel > project > Settings > Git > connect `HamdiHR/tutorial-tracker`); ask if it is done.
- **Supabase:** no direct admin tool. SQL migrations run automatically during each Vercel build (`scripts/migrate-hosted.js`, using `POSTGRES_URL*`). Dashboard changes (Auth Site URL, SMTP) are done by the user.
- **Sandbox network:** outbound access is limited; `npm install` was **refused** in the last chat (registry unreachable). The user said they would enable package installs in their settings. Test first: `cd <project> && timeout 60 npm view sql.js version`. If it prints a version, installs work.

## 3. Repository map

```
server/        local engine: api.js (all routes), db.js (SQLite schema/FTS5), plan.js (scheduling), extras.js (per-task data),
               progress.js, badges.js, static.js, index.js (HTTP server)
hosted/        handler.js (per-request overlay), state.js (hydrate/extract/diff), sql/001_init.sql, 002_owner.sql, 003_storage.sql,
               test/ (fake-supabase.js, dev-server.js, sql-checks.sql, sql-test.sh, stub-supabase.sql)
api/index.js   Vercel function entry (single function + rewrite /api/:path* -> /api/index?__p=...)
web/           index.html, sw.template.js, static/ (manifest, icons), src/*.js (UI), src/style.css
scripts/       build.cjs (esbuild + PWA files + sw.js), build-content.js (hosted/content.db), migrate-hosted.js, perf-baseline.cjs
content/       the tutorial markdown (11 sprints)
test/          *.test.js (node:test) and e2e/ (Playwright browser tests: run.cjs + *.e2e.cjs)
.github/workflows/ci.yml   CI
desktop/       optional Tauri shell (unverified)
planning-v0.4.md   the v0.40 plan (PWA + sync) with recorded decisions and delivery status
parked-claude-link.md   parked feature plan (MCP link to Claude); needs rework for free tier
PLAN-v0.4.md   the earlier plan (delivered as 0.39.x)
HOSTING.md, README.md, BACKLOG.md, SUGGESTIONS.md
```

## 4. How the hosted app works (important for the PWA work)

Per request: verify the person's Supabase token -> `tt_state` RPC (that person's saved rows) -> copy `hosted/content.db` (6.8 MB, shipped) to a temp SQLite -> `hydrate` the state onto it -> run unchanged `createApi` -> `extract` + `diff` -> `tt_apply` RPC writes only the differences. The person's own token is used for data calls, so Postgres RLS is the wall between users. The service key is used only for invites and the first-login flag.
`tt_apply` today is last-write-wins per row and **not idempotent** (activity/history inserts would duplicate on replay); the plan adds `tt_apply_v2` with operation ids.
Per-task extras (priority, labels, subtasks, files, blocked reason, comments `c`, dependencies `d`) live as JSON in meta key `tk:<ticketId>` (hosted-persisted via a prefix rule). Saved board filters: meta key `ui:views`. Files: local `<dataDir>/files/`, hosted Supabase Storage bucket `task-files` (private, per-user folder policies, client-side WebP compression, 25 MB limit).
Vercel gotcha: nested `/api/...` paths 404 with a catch-all file in a framework-less project, hence the single function + rewrite.

## 5. What is built (versions)

- **0.39**: hosted version (Vercel + Supabase), invite-only auth, onboarding, owner bootstrap.
- **0.39.1**: smart timeline start (anchor "continue from where I am", history sprints with real dates, target end date, forecast), version badge in sidebar; task drawer (assign you/Claude AI member, dates, priority, labels, subtasks, files/images, notes, steps); Gantt roadmap + team lanes + calendar + agenda + sprints; board upgrades (WIP limits, grouping, built-in saved views, collapse, density).
- **0.39.2**: shareable task link `/?t=<id>`, per-task comments (as me/Claude), burndown chart, `.ics` export.
- **0.39.3**: custom saved board filters (server `/api/views`), timeline minimap, dependencies (drawer "Depends on", red arrows on conflicts, warning only), "What if" scenario planner (`POST /api/plan/scenario`).
- **0.39.4**: installable PWA shell (manifest, icons incl. maskable, generated `sw.js`, Install button, "new version ready" banner, offline notice, config cached in `localStorage tt.cfg`, a dropped connection no longer signs you out), browser tests in repo, CI workflow.

Tests: **46** node tests (`npm run test:all` = hosted SQL checks + `test/*.test.js`) and **9** Playwright files (`npm run test:e2e`; hosted-* files need Postgres via `PGHOST/PGPORT/PGUSER`). All pass as of the last commit.

## 6. How to work on it (commands)

```bash
cd <repo>
npm install                               # needs package installs allowed
npm run build                             # builds public/ (also generates sw.js, copies web/static)
npm run build:content                     # builds hosted/content.db (needed by hosted tests)
npm start                                 # local app on http://127.0.0.1:4173
npm run test:all                          # needs Postgres env (see below)
npm run test:e2e [name-filter]            # Playwright; Chromium is preinstalled in the sandbox (require('playwright') works)
```

**Local Postgres for tests** (the old container had Postgres 16 at `/usr/lib/postgresql/16/bin`, data in `/var/tmp/ttpg/data`):
```bash
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/ttpg/data -o '-p 5544 -k /tmp' -l /var/tmp/ttpg.out start"
export PGHOST=/tmp PGPORT=5544 PGUSER=postgres
```
If the data folder is gone (new container): `su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/ttpg/data"` then start as above. If Postgres is not installed, CI on GitHub runs these tests (service container on port 5544).

**Release routine (manual deploy until Vercel is Git-connected):**
1. Bump `package.json` version (badge shows `v<major>.<minor>`), update README/plan status.
2. Run all tests.
3. Copy to the clone (exclude `node_modules data export target gen public hosted/content.db .git`), `git add -A`, commit with the trailer lines below, `git push origin main`.
4. `mcp__Vercel__create_deployment` with `gitSource {type:github, org:HamdiHR, repo:tutorial-tracker, ref:main, sha:<commit>}`, `target:production`, `teamId`, `skipAutoDetectionConfirmation:"1"`, `forceNew:"1"`, `requestBody.name/project = tutorial-tracker`.
5. Wait about 50 s, then check `https://tutorial-tracker-livid.vercel.app/api/config` shows the new version, and the build logs show the migration lines ("migrate: file storage bucket + policies applied").
Commit message trailer (required):
```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LKqNTpeCuHhYrpGZTsv72h
```
(Use the current session link if a newer attribution reminder is given.)

Gotchas learned: `web_fetch_vercel_url` is GET-only and mislabels app 401s as Vercel auth errors; `Element.append(null)` prints "null" (filter falsy); a CSS class named `hist` collided with an old rule (use `is-past`); in e2e, hosted sign-up works only for `owner@x.com` (the dev server pre-allows it); when editing public/ in tests, `.br/.gz` precompressed twins can serve stale files.

## 7. Decisions recorded (v0.40 plan)

1. Spike first (phase 0 gate, fallback "B-lite" = read-only offline + queued simple writes).
2. WASM SQLite library via npm: user will allow package installs and use a new chat.
3. Conflicts: newest wins + visible "Conflict copy" for text.
4. Connect Vercel to GitHub for auto deploy.
5. Devices: Android phone + Windows laptop (iPhone best effort).
6. Version name: v0.40 (package versions 0.39.x until the end).
Earlier decisions: each account has separate progress; the AI assistant "Claude" is a team member with `kind: 'ai'` (works any day); free-tier storage for files; Claude Link (MCP) is **parked**.

## 8. Phase status of v0.40 (see planning-v0.4.md sections 6 and 13)

| Phase | Status |
|---|---|
| 0. Spike: WASM SQLite runs `content.db` incl. FTS5 in a Worker; adapter for the `node:sqlite` calls `createApi` uses; start-up under 1.5 s on throttled mobile profile | **NOT STARTED, blocked on npm access** |
| 1. Browser tests in repo + CI + auto deploy | Done (auto deploy waits for the user to connect Vercel to GitHub; check the first CI run on GitHub Actions) |
| 2. Installable shell | Done and deployed |
| 3. Local engine in a Worker behind `web/src/api.js` + IndexedDB state/outbox | Not started |
| 4. Sync: `004_sync.sql` (`tt_ops`, `tt_apply_v2`, `updated_at`), outbox, rebase, conflict policy, clock correction, status chip, Sync panel | Not started |
| 5. Offline uploads (blob queue), thumbnail cache, persistent storage, multi-tab ownership (Web Locks) | Not started |
| 6. Enhancements: activity feed per task, JSON export/import, keyboard shortcuts, timeline PNG/PDF export; docs | Not started |

## 9. Next step (do this first)

1. Check package access: `timeout 60 npm view sql.js version`. If it fails, tell the user installs are still blocked and offer to continue with what needs no library (item 3).
2. **Phase 0 spike** in a scratch folder (not the repo): install `sql.js` (check its build has FTS5; if not, try `wa-sqlite`), load `hosted/content.db`, run a `steps_fts` MATCH query, time hydrate + overview with a recorded state, bundle `server/api.js` for the browser with `esbuild` aliasing `node:fs`, `node:path`, `node:crypto`, `node:sqlite` to shims, run it in a Playwright page inside a Worker with CPU throttling (CDP `Emulation.setCPUThrottlingRate` 4x). Report pass/fail against the criteria in planning-v0.4.md section 3.1 and **ask the user before continuing** (go full engine-in-browser, or fall back to B-lite).
3. Independent of the spike: check whether the CI workflow ran green on GitHub, and whether the user connected Vercel to GitHub.
4. Ask the user whether they tried (a) installing the app on Android Chrome and (b) one real image upload on the live site (hosted uploads were only tested against an emulated Storage).

## 10. Open items and honest limits

- Hosted file uploads untested against real Supabase Storage.
- Supabase free tier pauses after about a week of no traffic; auth emails use the built-in sender (rate-limited); Supabase Site URL must equal the production URL.
- `OWNER_BOOTSTRAP_PASSWORD` should be removed from Vercel env by the user.
- The Tauri desktop shell is unverified.
- Not built: dependency-aware scheduling (dependencies only warn), email reminders, native apps, local-data encryption, Claude Link (parked).
- Sandbox can't test on a real phone; Android/Windows checks need the user.

## 11. User preferences to remember

- Plans first when asked ("don't write code, just planning md"); build only when told ("start v0.40").
- One decision at a time with the recommended option first (`AskUserQuestion`, recommended = first option).
- Keep replies short; say what was built and what is not; honest "not built" lists.
- The user writes quickly with typos; interpret generously, confirm if ambiguous.
