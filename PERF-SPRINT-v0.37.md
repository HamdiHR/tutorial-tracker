# v0.37 Performance Sprint: audit and plan

Role: senior performance engineer / tech lead. Scope: the whole app (Node server + SQLite + vanilla-JS UI), measured on the real 11-sprint data set (147 tickets, 778 steps, 3-person team plan).
Measured with Chromium (Playwright + DevTools metrics), each page at native speed and with the CPU slowed 4x (about a mid-range laptop on battery). Harness: `scripts/perf-baseline.cjs`.

## 1. Verdict

The app does not have a "slow backend" problem. It has a **"too much DOM and too much rework in the browser"** problem, plus some avoidable network round trips.

| Layer | Measured | Verdict |
|---|---|---|
| Server | every API call 1 to 20 ms; warm start 126 ms; first-run import 304 ms | Healthy. Do not touch except small wins |
| SQLite | `overview` 7 ms, ticket 15 ms, search 2 ms | Healthy. Watch `allTickets()` (6 sub-queries x 148 rows) |
| Delivery | `app.js` 197 KB (65 KB gzip), `app.css` 54 KB, **no compression, no ETag**, re-sent on every load | Needs work (cheap) |
| Bundle | marked 42 KB + highlight.js 72 KB = **114 KB (58%) loaded on every page**, even the dashboard | Needs work |
| Board page | **4,771 DOM nodes**, long task 133 ms (518 ms at 4x), a card move = 4 requests + full re-render | **Main cause of the "heavy" feeling** |
| Other pages | Drift inbox 3,215 nodes (85 ms / 264 ms at 4x), Manage 2,225 nodes, Timeline Tasks 34 ms script | Medium |
| Network | overview fetched **twice** on first load; every page re-fetches overview and rebuilds the sidebar; step toggle = 3 requests | Needs work |
| Memory | no leak (stable after 3 full tours, heap 4 MB) | Healthy |

### Measured baseline (native / CPU x4)

| Scenario | Script | Style+layout | Longest task | DOM nodes | API calls |
|---|---|---|---|---|---|
| First load to dashboard visible | | | 326 ms / 1,417 ms | 1,500 | 3 (overview x2, plan) |
| Board open | 1 / 11 ms | 213 / 466 ms | **133 / 518 ms** | **4,771** | 2 |
| Board: group by sprint | 29 / 158 ms | 158 / 475 ms | 87 / 455 ms | 5,204 | 0 |
| Board: move one card | 5 / 7 ms | 157 / 441 ms | 68 / 374 ms | 4,774 | **4** |
| Timeline: Tasks view | 34 / 105 ms | 14 / 55 ms | 152 ms (4x) | 2,657 | 0 |
| Ticket: tick a step | 1 / 8 ms | 41 / 111 ms | none | 1,179 | **3** |
| Drift inbox | 1 / 13 ms | 106 / 241 ms | 85 / 264 ms | 3,215 | 1 |
| Manage | 2 / 13 ms | 66 / 139 ms | 106 ms (4x) | 2,225 | 1 |

Reading: scripting is small; **style recalculation and layout dominate** (they scale with node count and with animated elements).

### Experiments (board re-render, 4x CPU, 3 runs each)

| Change tried | Re-render cost | Result |
|---|---|---|
| Baseline | 670 ms | |
| Animations and transitions off | 390 ms | **-42%** |
| `content-visibility:auto` on cards | 260 to 414 ms (median about 330) | **about -50%** |
| `contain` on cards/columns | 760 to 820 ms | no gain, drop it |
| Remove shadows and backdrop-filter | 710 to 810 ms | no gain, ruled out |

## 2. Findings, ranked

Severity = user-felt impact x frequency. Gains are estimates from the experiments above, to be confirmed by the harness.

**F1. Board builds everything, every time (High).** 147 cards x about 32 nodes, 2 `<select>` per card, about 13 event listeners per card (1,911 page-wide). Every filter change, toggle or card move rebuilds all of it. A card move also re-fetches `overview` (twice) and `plan`.

**F2. Redundant and serial network (High).** First load: `overview` x2, then the dashboard waits for `plan` before painting. Each route calls `refreshOverview()`, which re-renders the whole sidebar tree even when nothing changed. Ticking a step: POST, then GET ticket, then GET overview.

**F3. Animation cost on the main thread (Medium to High).** Stagger "rise" on every page enter (also on re-renders), animated `@property --p` rings, per-card transitions. Turning animations off saves about 40% of a board re-render at 4x.

**F4. Eager 114 KB of markdown + syntax highlighting (Medium).** Needed only on ticket, editor and search pages, but parsed on every start. Languages loaded but rarely used: css (3 uses in the tutorials), sql (2), powershell, dos, ini, markdown, diff.

**F5. No HTTP caching or compression (Medium, becomes High on LAN or WebView cold start).** `Cache-Control: no-cache` without ETag means a full 250 KB re-download on each reload. JSON is never compressed (overview 44 KB, drift 53 KB, plan 34 KB). Static files are read synchronously from disk on every request.

**F6. Long lists render fully (Medium).** Drift inbox (153 items), Manage (all tickets of closed sprints are built but hidden), Board columns.

**F7. Payload shape and recomputation (Low to Medium).** `plan` response is 34 KB because the schedule is repeated; drift list sends full lines; `computeSchedule` is re-run on every ticket open (15 ms vs 3 ms for a plain ticket); `allTickets()` runs 6 correlated sub-queries per ticket.

**F8. Perceived speed (Medium).** Blank screen until the data arrives (326 ms native, 1.4 s at 4x). No skeletons, no cached last view.

**F9. Startup (Low).** A full `VACUUM INTO` backup (6.8 MB) runs on every start even if nothing changed; 126 ms today but it grows with notes and history.

Ruled out (measured, not a problem): server CPU, SQL speed, FTS search, memory leaks, web fonts (system fonts only), `backdrop-filter`/shadows.

## 3. Performance budgets (acceptance targets)

| Metric | Now (native / 4x) | Target (native / 4x) |
|---|---|---|
| Dashboard visible after first load | 326 / 1,417 ms | **<= 200 / 800 ms** |
| JS shipped on first load (minified) | 197 KB | **<= 100 KB** (marked + highlight only on ticket pages) |
| Wire size first load (compressed) | about 250 KB | **<= 70 KB** and 304 on reload |
| Board open, longest task | 133 / 518 ms | **<= 50 / 200 ms** |
| Board DOM nodes at open | 4,771 | **<= 1,800** |
| Board card move | 4 requests, 68 / 374 ms | **1 request, <= 16 / 100 ms** (in place) |
| Tick a step | 3 requests | **1 request** |
| Drift inbox DOM nodes | 3,215 | **<= 1,200** |
| Long tasks on any route change | up to 264 ms (4x) | **none over 100 ms at 4x** |

## 4. Sprint plan

Goal: "Every screen feels instant on a mid-range laptop; the board stays smooth with 150+ cards."
Capacity assumed: one developer, 5 working days (about 40 focused hours). Committed scope = P0 + P1. Stretch = P2. Two people can split along the lanes marked A (UI) and B (network/server).

### P0: must ship

| ID | Ticket | Lane | Est. | Acceptance criteria |
|---|---|---|---|---|
| PERF-01 | **Baseline and guardrail.** Keep `scripts/perf-baseline.cjs`, store the numbers above in `perf/baseline.json`, add `npm run perf` that fails when a budget is missed | B | 2 h | Run at 1x and 4x, median of 3; budgets file committed; before/after table filled at sprint end |
| PERF-02 | **Network de-dup.** One `overview` on load (`Promise.all` with `plan`), never block the dashboard on the plan banner, skip sidebar rebuild when data is unchanged, patch `S.overview` from mutation responses (step toggle and board move return the updated ticket summary) | B | 6 h | First load = 2 requests (parallel). Tick a step = 1 request. Board move = 1 request. No view awaits a second serial request |
| PERF-03 | **Board diet.** `content-visibility:auto` on cards; move a card in place (no re-render, update counts); filters hide/show instead of rebuilding; one delegated listener set instead of per-card; build the two selects lazily (on hover/focus/tap, or one shared menu); first 25 cards per column then "Show more" | A | 10 h | Open <= 1,800 nodes, longest task <= 50 ms; move <= 16 ms; drag and drop, keyboard menu and undo still work; e2e passes |
| PERF-04 | **Animation budget.** Entrance animation only on real navigation (not on re-renders), no stagger above 20 items, rings animate once, only `transform`/`opacity` animated, pause confetti when the tab is hidden. Reduced-motion unchanged | A | 4 h | Board re-render with animations on within 15% of animations off; no visual regression on the dashboard and celebrations |

### P1: should ship

| ID | Ticket | Lane | Est. | Acceptance criteria |
|---|---|---|---|---|
| PERF-05 | **Route code-splitting and lazy markdown.** esbuild ESM `splitting`, `<script type="module">`, dynamic `import()` per route (board, timeline, manage, achievements, drift, settings, celebrate). Load marked + highlight.js on first ticket/editor/search use; register rare languages (css, sql, powershell, dos, ini, markdown, diff) on demand | A | 8 h | Entry chunk <= 100 KB; ticket page identical in render; works in Chromium/Edge 105+ and the Tauri WebView2 |
| PERF-06 | **Static delivery.** Pre-compress `.br`/`.gz` at build, content-hashed filenames with `immutable`, ETag + 304 for `index.html`, in-memory file cache, gzip for JSON over 1 KB | B | 5 h | First load <= 70 KB on the wire; reload = 304s; unit test for ETag and encoding negotiation; still safe (no path traversal, Host check intact) |
| PERF-07 | **Long lists.** Drift inbox grouped by sprint, collapsed, rendered lazily (or "load more 50"); Manage builds a sprint's rows only when opened | A | 5 h | Drift <= 1,200 nodes, Manage <= 1,200 nodes; search/filter still work on collapsed groups |

### P2: stretch

| ID | Ticket | Lane | Est. | Acceptance criteria |
|---|---|---|---|---|
| PERF-08 | **Instant shell.** Cache the last overview locally (stale-while-revalidate), skeleton placeholders, no blank frame | A | 4 h | Dashboard paints in <= 100 ms on a second visit, then refreshes silently |
| PERF-09 | **Payload and server memo.** Slim `plan` (no duplicated schedule), shorter drift lines, a `rev` counter bumped by writes + ETag on `overview`/`plan` (304), memoize `computeSchedule` per (plan, progress) rev, rewrite `allTickets()` as one grouped query | B | 6 h | `plan` <= 15 KB; ticket open <= 5 ms server side; all 17 existing tests + new ones pass |
| PERF-10 | **Timeline zoom without rebuild.** Zoom via a CSS variable instead of re-creating 147 bars; shade off-days with one background pattern | A | 3 h | Zoom step <= 10 ms |

### P3: only if time remains

- PERF-11 Skip `VACUUM INTO` backup when the database has not changed; run it after the server starts listening (2 h).
- PERF-12 Measure and tune the Tauri/WebView2 build once it compiles (3 h; blocked on the untested desktop build).

Totals: P0 22 h, P1 18 h, P2 13 h, P3 5 h.

### Suggested schedule (1 developer)

| Day | Work |
|---|---|
| 1 | PERF-01 baseline, PERF-02 network de-dup (morning), PERF-04 animations (afternoon) |
| 2 | PERF-03 board diet (all day) |
| 3 | PERF-03 finish and test, PERF-07 long lists |
| 4 | PERF-05 code-splitting and lazy markdown |
| 5 | PERF-06 delivery, final measurements, release notes, buffer. Start PERF-08 if ahead |

Order matters: PERF-01 first so every later change has a number; PERF-02 before PERF-03 because in-place board moves rely on the new mutation responses.

## 5. Risks and mitigations

- **In-place board updates drift from the server.** Mitigation: server stays the source of truth; each mutation returns the ticket summary, and a background revalidate runs after 2 s.
- **ES module split breaks an old WebView.** Mitigation: keep the single-file build as a fallback script (`npm run build:single`) until the Tauri build is verified.
- **Cache headers serve a stale UI after an update.** Mitigation: hashed filenames, `index.html` always revalidated.
- **Lazy rendering hides content from Ctrl+F or from tests.** Mitigation: the in-app search covers all tickets; e2e tests open groups explicitly.
- **Regressions in drag and drop or celebrations.** Mitigation: keep the existing e2e (board DnD, Done ticks steps, undo) and add a perf check to it.

## 6. Verification protocol

1. Before: run the harness at 1x and 4x (3 runs, median) and save the table.
2. After each ticket: re-run, compare with its acceptance line, record in the ticket.
3. Functional: `npm test` (17 tests), the browser e2e for board, timeline drag, ticket tick, bulk, search; check phone width (390 px) for horizontal overflow.
4. Sprint review: one before/after table against section 3 and a short screen recording of the board with 150 cards.

## 7. Definition of done

Budgets in section 3 met or the miss explained; no new console errors; all tests green; README "Performance" note and release notes updated; baseline file updated.

## 8. Decisions I need from you (defaults chosen if you do not answer)

1. **Where does it feel heavy?** Default: board and timeline first (they are the measured hot spots). Tell me if it is another screen or the desktop window.
2. **Is a module-based build acceptable?** Default: yes, with the single-file fallback kept.
3. **Will teammates open the app over the network later?** Default: no, so compression and caching stay at P1; if yes, PERF-06 moves to P0.


## 9. Results (v0.37)

| Measure | Before | After (x1 / x4 CPU) |
|---|---|---|
| Ready-to-hero | 326 / 1,417 ms | 357 / 1,043 ms (headless, includes plan banner) |
| Board DOM nodes | 4,771 | ~1,600 |
| Board longest task (x4) | 518 ms | 67 ms |
| Event listeners | ~1,911 | 208 |
| Card move requests | 4 | 1 |
| Step toggle requests | 3 | 1 (+1 resume save) |
| Drift DOM nodes | 3,215 | ~1,300 |
| First-load JS+CSS | 197 KB JS | ~80 KB raw / 23 KB br |

Not reproduced: the 1-2 s freeze on copy (headless Chromium copies instantly). Mitigations shipped: optimistic copy feedback, lazy highlighting, content-visibility on code, no blur. Diagnostics: Settings > Performance log.

Hosting note: Vercel needs an external database and auth (see README).
