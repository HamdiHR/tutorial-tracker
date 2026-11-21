// Parses one sprint tutorial .md file into sections (tickets / reference) and steps.
// Round-trip safe: exportSprint(parse(text)) === text (LF-normalised).
//
// Structure recognised:
//   ## 🎫 S3-T01 — Title      -> ticket section   (also "## S2.6-T01 — Title", "## ⏭️ S2.6-T08 — … (DEFERRED)")
//   ## anything else           -> reference section (read-only, not counted in progress)
//   ### Heading                -> one step (slide). Text before the first ### is the "intro".
//   ### ✅ Verify …            -> step of kind "verify"
// Headings inside code fences are ignored (fence length aware, so ````markdown blocks are safe).

const TICKET_RE = /^(?:\S+\s+)?(S\d+(?:\.\d+)?-T\d+)\s*[—–-]\s*(.+)$/;
const PREP_RE = /^(?:\S+\s+)?(?:Step\s+\d+\b|Prerequisites\b|Windows\s*\+\s*Cmder)/i;
const VERIFY_RE =/^(?:✅\s*)?Verify\b/i;

export function normalise(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Returns [{i, level, text}] for level-2 and level-3 headings that are outside code fences. */
export function scanHeadings(lines) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null;
      continue;
    }
    if (m) {
      fence = { ch: m[1][0], len: m[1].length };
      continue;
    }
    const h = /^(#{2,3})[ \t]+(.*\S)[ \t]*$/.exec(line);
    if (h) out.push({ i, level: h[1].length, text: h[2] });
  }
  return out;
}

export function slug(s) {
  return (
    s
      .replace(/^\d+[.)]\s*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'step'
  );
}

/** Split a block of lines into leading blanks, body, and trailing blanks/`---` separators. */
export function splitPad(lines) {
  let a = 0;
  while (a < lines.length && lines[a].trim() === '') a++;
  let b = lines.length;
  while (b > a && (lines[b - 1].trim() === '' || lines[b - 1].trim() === '---')) b--;
  return { lead: lines.slice(0, a), body: lines.slice(a, b), tail: lines.slice(b) };
}

export function sprintIdFromFile(name) {
  const m = /sprint-([\d.]+?)-tutorial/i.exec(name) || /sprint-?([\d.]+)/i.exec(name);
  if (!m) return null;
  const raw = m[1].replace(/\.$/, '');
  const [maj, min] = raw.split('.');
  return min !== undefined ? `${parseInt(maj, 10)}.${min}` : String(parseInt(maj, 10));
}

export function parseSprintFile(fileName, rawText) {
  const text = normalise(rawText);
  const lines = text.split('\n');
  const id = sprintIdFromFile(fileName);
  if (id === null) throw new Error(`Cannot find the sprint number in file name "${fileName}" (expected sprint-XX-tutorial.md)`);

  const heads = scanHeadings(lines);
  const h2 = heads.filter((h) => h.level === 2);
  const headEnd = h2.length ? h2[0].i : lines.length;

  const sprintHeading = h2.find((h) => /^Sprint\b/i.test(h.text));
  const title = sprintHeading ? sprintHeading.text : `Sprint ${id}`;

  const sections = [];
  let refCount = 0;
  let prepCount = 0;
  h2.forEach((h, idx) => {
    const end = idx + 1 < h2.length ? h2[idx + 1].i : lines.length;
    const m = TICKET_RE.exec(h.text);
    const isPrep = !m && PREP_RE.test(h.text); // setup sections you actually perform (S0-P1…)
    const isTicket = !!m || isPrep;
    const sec = {
      kind: isTicket ? 'ticket' : 'ref',
      id: m ? m[1] : isPrep ? `S${id}-P${++prepCount}` : `S${id}-ref-${String(++refCount).padStart(2, '0')}`,
      title: m ? m[2].trim() : h.text,
      headingRaw: lines[h.i],
      deferred: m && (/\bDEFERRED\b/i.test(m[2]) || h.text.startsWith('⏭')) ? 1 : 0,
      steps: [],
    };

    // split into steps by ### headings (inside this section only)
    const subs = heads.filter((x) => x.level === 3 && x.i > h.i && x.i < end);
    const used = new Set();
    const mkKey = (base) => {
      let k = base;
      let n = 2;
      while (used.has(k)) k = `${base}-${n++}`;
      used.add(k);
      return k;
    };

    const introLines = lines.slice(h.i + 1, subs.length ? subs[0].i : end);
    sec.steps.push({
      key: 'intro',
      kind: 'intro',
      title: 'Overview',
      headingRaw: null,
      ...padded(introLines),
    });
    used.add('intro');

    subs.forEach((s, j) => {
      const sEnd = j + 1 < subs.length ? subs[j + 1].i : end;
      const verify = VERIFY_RE.test(s.text);
      sec.steps.push({
        key: mkKey(verify ? 'verify' : slug(s.text)),
        kind: sec.kind === 'ref' ? 'ref' : verify ? 'verify' : 'step',
        title: s.text,
        headingRaw: lines[s.i],
        ...padded(lines.slice(s.i + 1, sEnd)),
      });
    });

    // A ticket without ### steps: its intro IS the content, make it a checkable single step.
    if (sec.kind === 'ticket' && subs.length === 0) sec.steps[0].kind = 'step';
    if (sec.kind === 'ref') sec.steps[0].kind = 'ref';
    sections.push(sec);
  });

  return {
    sprint: {
      id,
      ord: parseFloat(id),
      title,
      file: fileName,
      head: lines.slice(0, headEnd).join('\n'),
    },
    sections,
  };
}

function padded(lines) {
  const { lead, body, tail } = splitPad(lines);
  return { lead, tail, body: body.join('\n') };
}

/** Rebuild the markdown file from section/step records (as stored in the DB). */
export function buildMarkdown(sprintHead, sections) {
  const out = [];
  if (sprintHead !== '' || sections.length === 0) out.push(...sprintHead.split('\n'));
  for (const sec of sections) {
    out.push(sec.headingRaw);
    for (const st of sec.steps) {
      if (st.heading_raw) out.push(st.heading_raw);
      out.push(...st.lead);
      if (st.body !== '') out.push(...st.body.split('\n'));
      out.push(...st.tail);
    }
  }
  return out.join('\n');
}
