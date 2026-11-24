// iCalendar (.ics) export with "start preparing" reminders.
import { TYPES, fromIso, addDays } from './parser.js?v=3';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// RFC 5545 lines must be folded at 75 octets.
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(courses) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TermRadar//Semester planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:TermRadar deadlines'];
  for (const c of courses) {
    for (const it of c.items) {
      const d = fromIso(it.date);
      const t = TYPES[it.type] || TYPES.assignment;
      const weight = it.weight ? ` · ${it.weight}% of grade` : '';
      lines.push(
        'BEGIN:VEVENT',
        `UID:${c.id}-${it.id}@termradar`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(d)}`,
        `DTEND;VALUE=DATE:${ymd(addDays(d, 1))}`,
        fold(`SUMMARY:${esc(`[${c.code}] ${it.title}`)}`),
        fold(`DESCRIPTION:${esc(`${t.label}${weight}\nPlanned with TermRadar`)}`),
        `CATEGORIES:${esc(t.label)}`,
      );
      if (t.prepDays > 0) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${t.prepDays}D`,
          fold(`DESCRIPTION:${esc(`Start preparing: ${c.code} ${it.title}`)}`), 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function download(filename, text, mime = 'text/calendar') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
