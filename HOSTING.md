# Hosting on Vercel + Supabase (v0.39)

The same app runs two ways: locally (SQLite, no sign-in) or hosted (Vercel + Supabase Postgres, email/password, invite-only).
Hosted mode is picked automatically: the browser asks `/api/config`.

## One-time setup (about 10 minutes)

1. **Create the tables.** Supabase dashboard -> your project -> SQL Editor -> New query.
   Paste `hosted/sql/001_init.sql`, Run. Then paste `hosted/sql/002_owner.sql` (edit the email if it is not yours), Run.
   Both are safe to run again.
2. **Tell Supabase your site address.** Authentication -> URL Configuration: set *Site URL* to your Vercel address
   (for example `https://tutorial-tracker.vercel.app`) and add the same address under *Redirect URLs*.
   Optional: Authentication -> Sign In / Providers -> Email: turn "Confirm email" off if you do not want a confirmation mail on sign-up.
3. **Deploy.** From this folder: `npx vercel link` (pick the existing project `tutorial-tracker`), then `npx vercel deploy --prod`.
   (Or push the folder to a GitHub repo and import it in Vercel; the build settings come from `vercel.json`.)
4. **Open the site to your people.** Vercel project -> Settings -> Deployment Protection: switch off "Vercel Authentication"
   (the app has its own sign-in). Otherwise everyone must also have a Vercel account.
5. Open the site, choose **Create account** with the owner email, answer the first-login question. Invite others in Settings -> People.

Environment variables the Supabase integration already set: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Optional: `APP_TZ` (time zone for streak days, default UTC; already set to Africa/Tunis), `SITE_URL` (override the address used in invite emails).

## How it works

- The tutorial text ships with the app (`hosted/content.db`, built from `content/` at deploy). Supabase stores only what each person does.
- Each API call: verify the token with Supabase -> load that person's saved state (one call) -> run the normal app engine on a private copy -> save only what changed (one call).
- Row-level security keeps people apart in the database; sign-up is limited to emails in `tt_allowed_emails`.
- To change the tutorial: edit `content/*.md`, redeploy. Edits people made to a slide are kept.

## File uploads
The build also applies `hosted/sql/003_storage.sql` (private bucket `task-files` + per-user policies). If the build log shows a storage warning, run that file once in the Supabase SQL editor. The Content-Security-Policy in `vercel.json` already allows `https://*.supabase.co` images.

## Known limits

- Free Supabase projects pause after about a week without use (first visit afterwards is slow).
- Supabase's built-in email sender is rate limited; configure your own SMTP before inviting many people.
- Streak days follow `APP_TZ` for everyone (one time zone per deployment).
- Import/export of markdown, backups and the local data folder are local-mode features and are off when hosted.
- If you change `content/` so that step order or ids shift, saved resume positions may point to another step (progress itself is keyed by ticket + step key and is safe).

## Tests

`npm run test:hosted` needs `psql` and a local Postgres (`PGHOST/PGPORT/PGUSER`); it runs the SQL checks and the full hosted flow against a fake Supabase.
