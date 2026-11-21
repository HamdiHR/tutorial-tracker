// Celebrations: confetti, ticket / sprint / level / badge moments. All skipped under "reduce motion".
import { h } from './dom.js';
import { openModal } from './modal.js';
import { reduceMotion } from './motion.js';
import { medal as uiMedal, TIER_NAMES } from './ui.js';

const COLORS = ['#7aa2ff', '#3fb27f', '#e3a93b', '#ff7a90', '#b78bff', '#5ee0d0', '#ffffff'];
let canvas;
let ctx;
let parts = [];
let raf = 0;

function ensureCanvas() {
  if (canvas) return;
  canvas = h('canvas', { id: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
}
function size() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function tick() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vy += 0.3;
    p.vx *= 0.992;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, 7);
      ctx.fill();
    } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(tick);
  else {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    canvas.remove();
    canvas = null;
    raf = 0;
  }
}

/** Burst of confetti from a point. angle: radians (-PI/2 = straight up), spread: cone width. */
export function confetti({ x = innerWidth / 2, y = innerHeight * 0.7, count = 90, angle = -Math.PI / 2, spread = Math.PI * 0.8, power = 1 } = {}) {
  if (reduceMotion()) return;
  ensureCanvas();
  size();
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = (6 + Math.random() * 9) * power;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.25, life: 70 + Math.random() * 60 });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

const rise = (el) => el?.getBoundingClientRect();
let lastSprintAt = 0;

export function ticketComplete(title, anchor) {
  if (Date.now() - lastSprintAt < 4000) return; // the sprint celebration already covers it
  const r = rise(anchor);
  confetti({ x: r ? r.left + r.width / 2 : innerWidth / 2, y: r ? r.top : innerHeight - 80, count: 70, power: 0.9 });
  banner('✓', 'Ticket complete', title, '+50 XP');
}

function banner(icon, title, sub, xp) {
  document.getElementById('banner')?.remove();
  const el = h('div', { id: 'banner', class: 'banner-pop', role: 'status' },
    h('span', { class: 'bp-ic' }, icon),
    h('div', {}, h('strong', {}, title), h('div', { class: 'muted small ell' }, sub)),
    xp ? h('span', { class: 'xp-chip' }, xp) : null);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

export function levelUp(player) {
  confetti({ x: innerWidth / 2, y: innerHeight * 0.35, count: 110, angle: -Math.PI / 2, spread: Math.PI * 1.4, power: 0.85 });
  banner('⬆', `Level ${player.level} · ${player.title}`, 'You levelled up', '');
}

export function sprintComplete(u, overview) {
  lastSprintAt = Date.now();
  const sp = overview?.sprints?.find((s) => s.id === u.sprintId);
  let m;
  const view = h('div', { class: 'celebrate' },
    h('div', { class: 'cel-trophy' }, h('span', {}, '🏆')),
    h('h2', {}, `Sprint ${u.sprintId} complete!`),
    h('p', { class: 'muted' }, u.detail || sp?.title || ''),
    sp ? h('div', { class: 'cel-stats' }, h('div', {}, h('b', {}, sp.ticketsTotal), ' tickets'), h('div', {}, h('b', {}, sp.total), ' steps')) : null,
    h('div', { class: 'xp-chip big' }, '+250 XP'),
    h('div', { class: 'cel-actions' },
      h('a', { class: 'btn', href: '#/achievements', onClick: () => m.close(true) }, 'See trophies'),
      h('button', { class: 'btn primary', onClick: () => m.close(true) }, 'Keep going →')));
  m = openModal(view, { label: 'Sprint complete', celebrate: true });
  setTimeout(() => {
    confetti({ x: innerWidth * 0.2, y: innerHeight * 0.85, count: 120, angle: -Math.PI * 0.35, spread: 0.9 });
    confetti({ x: innerWidth * 0.8, y: innerHeight * 0.85, count: 120, angle: -Math.PI * 0.65, spread: 0.9 });
    confetti({ x: innerWidth / 2, y: innerHeight * 0.5, count: 100, spread: Math.PI * 2, power: 0.7 });
  }, 250);
}

const medal = (u) => uiMedal(u.icon, u.kind === 'sprint' ? 2 : Math.max(0, TIER_NAMES.indexOf(u.tierName)), 'sm');

function badgeToast(u) {
  let box = document.getElementById('badge-toasts');
  if (!box) {
    box = h('div', { id: 'badge-toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('a', { class: 'badge-toast', href: '#/achievements' }, medal(u), h('div', {}, h('div', { class: 'bt-kicker' }, 'Achievement unlocked'), h('strong', {}, `${u.title} · ${u.tierName}`), h('div', { class: 'muted small' }, u.detail)));
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 4600);
  setTimeout(() => el.remove(), 5000);
}

function summary(list) {
  let m;
  const view = h('div', { class: 'celebrate' },
    h('div', { class: 'cel-trophy' }, h('span', {}, '🎉')),
    h('h2', {}, `${list.length} new achievements`),
    h('div', { class: 'cel-grid' }, list.map((u) => h('div', { class: 'cel-item' }, medal(u), h('div', {}, h('strong', {}, u.title), h('div', { class: 'muted small' }, u.tierName + (u.detail ? ' · ' + u.detail : '')))))),
    h('div', { class: 'cel-actions' }, h('a', { class: 'btn', href: '#/achievements', onClick: () => m.close(true) }, 'Open achievements'), h('button', { class: 'btn primary', onClick: () => m.close(true) }, 'Nice!')));
  m = openModal(view, { label: 'New achievements', celebrate: true });
  setTimeout(() => confetti({ x: innerWidth / 2, y: innerHeight * 0.4, count: 140, spread: Math.PI * 2, power: 0.8 }), 200);
}

/** Single entry point for "the server says these were just unlocked". */
export function handleUnlocked(list, overview) {
  const sprints = list.filter((u) => u.kind === 'sprint');
  const badges = list.filter((u) => u.kind === 'badge');
  if (list.length >= 4 || sprints.length > 1) return summary(list);
  if (sprints.length === 1) sprintComplete(sprints[0], overview);
  badges.forEach((b, i) => setTimeout(() => badgeToast(b), 350 + i * 450));
}
