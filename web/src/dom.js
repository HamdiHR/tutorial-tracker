export const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny hyperscript: h('div', {class:'x', onClick:fn}, child, 'text', [more]) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (['value', 'checked', 'disabled', 'title', 'href', 'placeholder', 'type', 'id', 'spellcheck', 'download', 'open', 'rows', 'target', 'rel', 'accept', 'multiple'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

let toastTimer;
/** toast(msg, kind?, {label, fn}?, ms?) - an optional action button (e.g. Undo) stays clickable. */
export function toast(msg, kind = '', action = null, ms) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.replaceChildren(document.createTextNode(msg));
  if (action) el.append(h('button', { class: 'toast-act', onClick: () => { el.className = ''; action.fn(); } }, action.label));
  el.className = 'show ' + kind + (action ? ' has-act' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), ms ?? (kind === 'err' ? 5000 : action ? 9000 : 1800));
}

export function ago(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString();
}

export function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

/** Progress bar. `from` (0-100) is where the fill animates from, so updates glide instead of restarting. */
export function bar(done, total, cls = '', from = 0) {
  return h('div', { class: 'bar ' + cls, role: 'progressbar', 'aria-valuenow': pct(done, total), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: pct(done, total) + '%', '--from': from + '%' } }));
}
