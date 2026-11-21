// Light facade: the heavy parts (marked + highlight.js, about 110 KB) live in md-core.js and load on first use.
let core = null;
export async function ensureMd() {
  if (!core) core = await import('./md-core.js');
  return core;
}
const need = () => { if (!core) throw new Error('Markdown not loaded yet'); return core; };
export const renderMarkdown = (src) => need().renderMarkdown(src);
export const renderInline = (src) => need().renderInline(src);
export const highlightIn = (root) => core?.highlightIn(root);

let sink = null; // one reusable hidden textarea for the fallback path
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    sink ||= Object.assign(document.createElement('textarea'), { readOnly: true, ariaHidden: 'true', tabIndex: -1 });
    sink.style.cssText = 'position:fixed;top:-1000px;left:0;width:1px;height:1px;opacity:0;contain:strict';
    sink.value = text;
    document.body.append(sink);
    sink.focus({ preventScroll: true });
    sink.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    sink.remove();
    return ok;
  }
}

/** One delegated handler for every .copy button inside `root`. Feedback is instant; the clipboard write finishes in the background. */
export function bindCopy(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button.copy');
    if (!btn) return;
    const code = btn.closest('.code')?.querySelector('code');
    if (!code) return;
    const text = code.textContent.replace(/\n$/, '');
    btn.textContent = 'Copied ✓';
    btn.classList.add('ok');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1400);
    const t0 = performance.now();
    copyText(text).then((ok) => {
      import('./perf.js').then((p) => p.noteSlow('copy', performance.now() - t0, `${text.length} chars`));
      if (!ok) { btn.textContent = 'Copy failed'; btn.classList.remove('ok'); }
    });
  });
}
