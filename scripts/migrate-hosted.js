// Runs on every Vercel build (before the app is built): applies hosted/sql/001_init.sql (idempotent),
// allows OWNER_EMAIL to register as owner and, if OWNER_BOOTSTRAP_PASSWORD is set, creates that account once.
// Skipped everywhere else (your laptop, tests) unless you pass --force.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
if (!env.VERCEL && !process.argv.includes('--force')) { console.log('migrate: skipped (not a Vercel build)'); process.exit(0); }
const dbUrl = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
if (!dbUrl) { console.log('migrate: no database URL in the environment, skipped'); process.exit(0); }

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: dbUrl.replace(/\?.*$/, ''), ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(fs.readFileSync(path.join(root, 'hosted/sql/001_init.sql'), 'utf8'));
  console.log('migrate: schema applied');
  await client.query(fs.readFileSync(path.join(root, 'hosted/sql/004_sync.sql'), 'utf8'));
  console.log('migrate: sync tables + tt_apply_v2 applied');
  try {
    await client.query(fs.readFileSync(path.join(root, 'hosted/sql/003_storage.sql'), 'utf8'));
    console.log('migrate: file storage bucket + policies applied');
  } catch (e) {
    console.warn('migrate: WARNING file storage not set up (attachments stay disabled until it is):', e.message);
  }

  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner) {
    await client.query(`INSERT INTO tt_allowed_emails (email, role) VALUES ($1, 'owner') ON CONFLICT (email) DO UPDATE SET role = 'owner'`, [owner]);
    console.log('migrate: owner email allowed:', owner.replace(/^(.).*(@.*)$/, '$1***$2'));
    const pw = env.OWNER_BOOTSTRAP_PASSWORD;
    const base = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
    const have = await client.query('SELECT 1 FROM tt_profiles WHERE email = $1', [owner]);
    if (pw && base && key && !have.rowCount) {
      const headers = { apikey: key, 'content-type': 'application/json' };
      if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
      const r = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email: owner, password: pw, email_confirm: true }) });
      const body = await r.text();
      console.log('migrate: owner account', r.ok ? 'created' : `not created (${r.status}) ${body.slice(0, 200).replace(pw, '***')}`);
    } else console.log('migrate: owner account', have.rowCount ? 'already exists' : 'not created (no bootstrap password)');
    const prof = await client.query('SELECT role FROM tt_profiles WHERE email = $1', [owner]);
    console.log('migrate: owner profile role =', prof.rows[0]?.role ?? '(none yet)');
  }
} catch (e) {
  console.error('migrate: FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
