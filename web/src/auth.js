// Hosted mode sign-in (Supabase Auth over plain fetch; no SDK). In local mode none of this runs.
import { h } from './dom.js';
import { api, setAuth } from './api.js';
import { engine } from './engine.js';
import { S, ls } from './state.js';

const KEY = 'tt.session';
let cfg = null;
let session = null; // {access_token, refresh_token, expires_at (s)}
let refreshing = null;

const load = () => { try { session = JSON.parse(ls(KEY) || 'null'); } catch { session = null; } };
const save = (s) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };
const fromGrant = (g) => ({ access_token: g.access_token, refresh_token: g.refresh_token, expires_at: g.expires_at || Math.floor(Date.now() / 1000) + (g.expires_in || 3600), ...(g.user?.id ? { user: { id: g.user.id } } : {}) });
/** Who is signed in, without a network call (saved with the session; falls back to the token's own claim). */
export function sessionUserId() {
  if (session?.user?.id) return session.user.id;
  try { return JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; }
}

async function auth(method, path, body, token) {
  let r;
  try {
    r = await fetch(`${cfg.supabaseUrl}/auth/v1${path}`, { method, headers: { apikey: cfg.anonKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { const e = new Error('Cannot reach the sign-in service. Check your connection.'); e.network = true; throw e; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendly(data.msg || data.message || data.error_description || data.error || `Error ${r.status}`));
  return data;
}
function friendly(m) {
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/database error saving new user|not been invited/i.test(m)) return 'This email has not been invited. Ask the owner to invite you.';
  if (/already registered|already been registered/i.test(m)) return 'This email already has an account. Use Sign in.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox).';
  if (/password should be|at least/i.test(m)) return 'Use a password of at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
  return m;
}

/** A valid access token, refreshed a minute before it expires. */
export async function getToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= auth('POST', '/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((g) => { save(fromGrant(g)); return session.access_token; })
    .catch((e) => { if (e.network) throw e; save(null); return null; }) // a dropped connection must never sign you out
    .finally(() => { refreshing = null; });
  return refreshing;
}

export function signOut() {
  const t = session?.access_token;
  save(null);
  try { localStorage.removeItem('tt.me'); } catch {}
  if (t) fetch(`${cfg.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${t}` } }).catch(() => {});
  location.hash = '';
  engine.wipe().finally(() => location.reload()); // forget this device's copy of the data
}

/** Links in invitation / reset emails land here with the tokens in the URL fragment. */
function takeLinkSession() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!raw.includes('access_token=') && !raw.includes('error_description=')) return null;
  const q = new URLSearchParams(raw);
  history.replaceState(null, '', location.pathname + location.search);
  if (q.get('error_description')) return { error: q.get('error_description').replace(/\+/g, ' ') };
  return { type: q.get('type') || 'signup', grant: { access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: Number(q.get('expires_in')) || 3600, expires_at: Number(q.get('expires_at')) || 0 } };
}

function screen(title, sub, ...kids) {
  const el = h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('div', { class: 'auth-logo' }, '☰'), h('h1', {}, title), sub ? h('p', { class: 'muted' }, sub) : null, ...kids));
  document.body.classList.add('auth-open');
  document.body.append(el);
  return el;
}
const field = (label, props) => h('label', { class: 'auth-field' }, h('span', {}, label), h('input', { class: 'text-input', required: true, ...props }));
const msgBox = () => h('div', { class: 'auth-msg', role: 'alert' });
const say = (box, text, ok) => { box.textContent = text; box.className = 'auth-msg ' + (ok ? 'ok' : 'err'); };

function form(el, box, btnLabel, run) {
  const btn = h('button', { class: 'btn primary lg', type: 'submit' }, btnLabel);
  const f = h('form', { class: 'auth-form', onSubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; say(box, '');
    try { await run(new FormData(f)); } catch (err) { say(box, err.message); }
    btn.disabled = false;
  } });
  return { f, btn };
}

/** Shows the right screen until someone is signed in; resolves with true when the app can start. */
function loginFlow(startMode = 'login', note = '') {
  return new Promise((resolve) => {
    let el;
    const done = () => { el.remove(); document.body.classList.remove('auth-open'); resolve(true); };
    const show = (mode, notice = '') => {
      el?.remove();
      const box = msgBox();
      if (notice) say(box, notice, true);
      const link = (text, to) => h('button', { class: 'link', type: 'button', onClick: () => show(to) }, text);
      if (mode === 'login') {
        const { f, btn } = form(null, box, 'Sign in', async (d) => {
          const g = await auth('POST', '/token?grant_type=password', { email: d.get('email').trim(), password: d.get('password') });
          save(fromGrant(g)); done();
        });
        f.append(field('Email', { name: 'email', type: 'email', autocomplete: 'username' }), field('Password', { name: 'password', type: 'password', autocomplete: 'current-password' }), box, btn);
        el = screen('Tutorial Tracker', 'Sign in to continue.', f, h('div', { class: 'auth-links' }, link('Forgot password?', 'forgot'), link('Create account', 'signup')));
      } else if (mode === 'signup') {
        const { f, btn } = form(null, box, 'Create account', async (d) => {
          if (d.get('password') !== d.get('again')) throw new Error('The two passwords do not match.');
          const g = await auth('POST', '/signup', { email: d.get('email').trim(), password: d.get('password') });
          if (g.access_token) { save(fromGrant(g)); return done(); }
          show('login', 'Account created. Check your email to confirm it, then sign in.');
        });
        f.append(field('Email (the one you were invited with)', { name: 'email', type: 'email', autocomplete: 'username' }), field('Password (8+ characters)', { name: 'password', type: 'password', minlength: 8, autocomplete: 'new-password' }), field('Repeat password', { name: 'again', type: 'password', minlength: 8, autocomplete: 'new-password' }), box, btn);
        el = screen('Create your account', 'Only invited email addresses can register.', f, h('div', { class: 'auth-links' }, link('Back to sign in', 'login')));
      } else if (mode === 'forgot') {
        const { f, btn } = form(null, box, 'Send reset link', async (d) => {
          await auth('POST', `/recover?redirect_to=${encodeURIComponent(location.origin)}`, { email: d.get('email').trim() });
          show('login', 'If that email has an account, a reset link is on its way.');
        });
        f.append(field('Email', { name: 'email', type: 'email', autocomplete: 'username' }), box, btn);
        el = screen('Reset your password', null, f, h('div', { class: 'auth-links' }, link('Back to sign in', 'login')));
      }
    };
    show(startMode, note);
  });
}

function setPasswordFlow(grant, why) {
  return new Promise((resolve) => {
    const box = msgBox();
    const { f, btn } = form(null, box, 'Save password and continue', async (d) => {
      if (d.get('password') !== d.get('again')) throw new Error('The two passwords do not match.');
      await auth('PUT', '/user', { password: d.get('password') }, grant.access_token);
      save(fromGrant(grant));
      el.remove(); document.body.classList.remove('auth-open'); resolve(true);
    });
    f.append(field('New password (8+ characters)', { name: 'password', type: 'password', minlength: 8, autocomplete: 'new-password' }), field('Repeat password', { name: 'again', type: 'password', minlength: 8, autocomplete: 'new-password' }), box, btn);
    const el = screen(why === 'invite' ? 'Welcome! Choose a password' : 'Choose a new password', null, f);
  });
}

/** Call once at start. Resolves when the app may run (local mode: immediately). */
export async function startAuth() {
  cfg = await api.config();
  S.hosted = !!cfg.hosted;
  if (!cfg.hosted) return;
  load();
  setAuth(getToken, () => { save(null); engine.wipe(); loginFlow('login', 'Your session ended. Please sign in again.').then(() => location.reload()); });
  const link = takeLinkSession();
  if (link?.grant && ['invite', 'recovery'].includes(link.type)) await setPasswordFlow(link.grant, link.type);
  else if (link?.grant) save(fromGrant(link.grant));
  if (!session) await loginFlow('login', link?.error ? `That link did not work: ${link.error}` : '');
  else {
    try { if (!(await getToken())) await loginFlow('login', 'Please sign in again.'); }
    catch (e) { if (!(e.network && session)) throw e; S.offline = true; } // no connection but a saved session: keep going with this device's copy
  }
  // Signed in: load the local engine. Online the app does not wait for it; offline it must (there is no server to fall back to).
  const started = engine.attach(getToken, sessionUserId());
  if (S.offline) await started;
}

/** Hosted: change the password of the signed-in person. */
export async function changePassword(password) {
  const t = await getToken();
  if (!t) throw new Error('Please sign in again.');
  await auth('PUT', '/user', { password }, t);
}
