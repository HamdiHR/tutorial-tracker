// .ics export of the plan: one all-day event per ticket (finished history excluded), importable in Google/Apple/Outlook calendars.
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/[;,]/g, (m) => '\\' + m).replace(/\r?\n/g, '\\n');
const compact = (d) => d.replaceAll('-', '');
const next = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const fold = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };

export function buildIcs(sch, name = 'Tutorial Tracker') {
  const team = new Map((sch.team || []).map((m) => [m.id, m]));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${name}//v0.4//EN`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const sp of sch.sprints || []) for (const t of sp.schedule || []) {
    if (t.history || t.status === 'done') continue;
    const who = team.get(t.member);
    lines.push('BEGIN:VEVENT', `UID:${t.id}@tutorial-tracker`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(t.start)}`, `DTEND;VALUE=DATE:${compact(next(t.due))}`,
      fold('SUMMARY:' + esc(`${t.id} ${t.title}${who && team.size > 1 ? ` (${who.name})` : ''}`)), fold('DESCRIPTION:' + esc(`Sprint ${sp.id} · ${t.done}/${t.steps} steps done`)), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadIcs(sch) {
  const url = URL.createObjectURL(new Blob([buildIcs(sch)], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'tutorial-plan.ics' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
