import { h } from './dom.js';

/** Line diff -> [{t:' '|'+'|'-', s}]. Trims common prefix/suffix, LCS in the middle. */
export function diffLines(aText, bText) {
  const a = aText.split('\n');
  const b = bText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const A = a.slice(s, ea);
  const B = b.slice(s, eb);
  const ops = a.slice(0, s).map((x) => ({ t: ' ', s: x }));
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) {
    A.forEach((x) => ops.push({ t: '-', s: x }));
    B.forEach((x) => ops.push({ t: '+', s: x }));
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        ops.push({ t: ' ', s: A[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: '-', s: A[i++] });
      else ops.push({ t: '+', s: B[j++] });
    }
    while (i < n) ops.push({ t: '-', s: A[i++] });
    while (j < m) ops.push({ t: '+', s: B[j++] });
  }
  for (let k = ea; k < a.length; k++) ops.push({ t: ' ', s: a[k] });
  return ops;
}

export function diffStats(ops) {
  return { add: ops.filter((o) => o.t === '+').length, del: ops.filter((o) => o.t === '-').length };
}

/** Renders a unified-style diff, collapsing long unchanged runs. */
export function renderDiff(ops, ctx = 3) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.t !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
  });
  const out = h('div', { class: 'diff' });
  if (!ops.some((o) => o.t !== ' ')) return h('div', { class: 'diff' }, h('p', { class: 'muted pad' }, 'No differences.'));
  let skipped = 0;
  const flush = () => {
    if (skipped) out.append(h('div', { class: 'diff-gap' }, `⋯ ${skipped} unchanged line${skipped > 1 ? 's' : ''} ⋯`));
    skipped = 0;
  };
  ops.forEach((o, i) => {
    if (!keep[i]) return void skipped++;
    flush();
    out.append(h('div', { class: 'dl ' + (o.t === '+' ? 'add' : o.t === '-' ? 'del' : '') }, h('span', { class: 'sign' }, o.t === ' ' ? '' : o.t), h('span', { class: 'txt' }, o.s || ' ')));
  });
  flush();
  return out;
}
