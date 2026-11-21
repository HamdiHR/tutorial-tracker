import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import { esc } from './dom.js';

// Languages load on first use (each is its own small file), so the first screen does not pay for them.
const LOADERS = {
  typescript: () => import('highlight.js/lib/languages/typescript'), javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'), bash: () => import('highlight.js/lib/languages/bash'),
  yaml: () => import('highlight.js/lib/languages/yaml'), css: () => import('highlight.js/lib/languages/css'),
  xml: () => import('highlight.js/lib/languages/xml'), markdown: () => import('highlight.js/lib/languages/markdown'),
  diff: () => import('highlight.js/lib/languages/diff'), ini: () => import('highlight.js/lib/languages/ini'),
  sql: () => import('highlight.js/lib/languages/sql'), powershell: () => import('highlight.js/lib/languages/powershell'),
  dos: () => import('highlight.js/lib/languages/dos'),
};
const loading = new Map();
const ensureLang = (name) => {
  if (!loading.has(name)) loading.set(name, LOADERS[name]().then((m) => hljs.registerLanguage(name, m.default)));
  return loading.get(name);
};

const ALIAS = {
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript', js: 'javascript', jsx: 'javascript', javascript: 'javascript', mjs: 'javascript',
  json: 'json', jsonc: 'json', bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', yaml: 'yaml', yml: 'yaml', css: 'css',
  html: 'xml', xml: 'xml', svg: 'xml', markdown: 'markdown', md: 'markdown', diff: 'diff', ini: 'ini', toml: 'ini', dotenv: 'ini', env: 'ini',
  sql: 'sql', powershell: 'powershell', ps1: 'powershell', cmd: 'dos', bat: 'dos',
};

const SAFE_TAGS = /^<\/?(br|details|summary|kbd|sub|sup|b|i|em|strong|mark|p|ul|ol|li|hr)\s*\/?>$/i;
const CALLOUT = { '⚠️': 'warn', '⚠': 'warn', '🔎': 'note', 'ℹ️': 'info', 'ℹ': 'info', '🪟': 'win', '💡': 'tip', '🔍': 'drift', '✅': 'ok', '❌': 'bad', '🔒': 'warn' };

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      const language = ALIAS[l];
      // Plain text first: highlighting happens lazily (see highlightIn), so opening a slide stays fast.
      return `<div class="code"><div class="code-head"><span>${esc(l || 'text')}</span><button type="button" class="copy">Copy</button></div><pre><code class="hljs"${language ? ` data-lang="${language}"` : ''}>${esc(text)}</code></pre></div>`;
    },
    blockquote({ tokens }) {
      const inner = this.parser.parse(tokens);
      const m = /^\s*<p>\s*(⚠️|⚠|🔎|ℹ️|ℹ|🪟|💡|🔍|✅|❌|🔒)/.exec(inner);
      return `<blockquote${m ? ` class="co-${CALLOUT[m[1]]}"` : ''}>${inner}</blockquote>`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:|#|\/|\.)/i.test(href) ? href : '#';
      return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ href, text }) {
      return /^https?:/i.test(href) ? `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">` : esc(text);
    },
    html({ text }) {
      return SAFE_TAGS.test(text.trim()) ? text : esc(text);
    },
  },
});

const mdCache = new Map();
export function renderMarkdown(src) {
  src = src || '';
  let html = mdCache.get(src);
  if (html === undefined) {
    html = marked.parse(src, { async: false });
    if (mdCache.size > 120) mdCache.delete(mdCache.keys().next().value);
    mdCache.set(src, html);
  }
  return html;
}

export function renderInline(src) {
  return marked.parseInline(src || '', { async: false });
}


// ---- lazy, idle-time syntax highlighting ---------------------------------------------------------
const hlCache = new Map();
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 250 }) : setTimeout(r, 16)));
let chain = Promise.resolve();

async function highlightOne(code) {
  if (!code.isConnected || code.dataset.hl) return;
  const lang = code.dataset.lang;
  const text = code.textContent;
  const key = lang + '\0' + text;
  let html = hlCache.get(key);
  if (html === undefined) {
    await ensureLang(lang);
    if (!code.isConnected) return;
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    if (hlCache.size > 300) hlCache.delete(hlCache.keys().next().value);
    hlCache.set(key, html);
  }
  const sel = getSelection();
  if (sel && !sel.isCollapsed && code.contains(sel.anchorNode)) { code.dataset.hl = 'skip'; return; } // never disturb a selection
  code.innerHTML = html;
  code.dataset.hl = '1';
  await idle(); // yield between blocks so scrolling and clicks stay responsive
}

/** Highlights code blocks inside `root` when they come near the viewport, one at a time. */
export function highlightIn(root) {
  const blocks = [...root.querySelectorAll('code[data-lang]:not([data-hl])')];
  if (!blocks.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      chain = chain.then(() => highlightOne(e.target)).catch(() => {});
    }
  }, { rootMargin: '900px 0px' });
  blocks.forEach((b) => io.observe(b));
}
