# Changelog

## 0.40.2 (2026-11-28)

### Other
- v0.40 phase 5: two tabs. One tab owns the engine and the outbox (Web Locks); others use the server and take over

## 0.40.1 (2026-11-28)

### Other
- v0.40 phase 4: pull. Notice changes made on another device while the app is open, offer a Refresh
- v0.40 phase 4: Sync panel (waiting changes, Sync now, JSON export, reset device), status chip, sign-out warning

## 0.40.0 (2026-11-28)

### Other
- Version management: release script, build id in the app, CI version check
- v0.40 phase 4: Sync panel (waiting changes, Sync now, JSON export, reset device), status chip, sign-out warning
- v0.40 phase 4: conflicts. Newest note wins, the other is kept as a Conflict copy; checkbox/status newest wins
- v0.40 phase 4: offline changes are dated when made; clock correction from the server time
- v0.40 phase 4 (client): save offline, upload later (outbox, rebase, operation ids)
- v0.40 phase 4 (database): tt_ops, tt_apply_v2 (idempotent saves), updated_at, SQL tests

