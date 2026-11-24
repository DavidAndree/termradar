// TermRadar rule-based syllabus parser.
// chrono-node is injected so the same code runs in the browser (CDN) and in Node tests (npm).

export const TYPES = {
  exam:         { label: 'Exam',         load: 5,   prepDays: 7,  icon: '◆' },
  project:      { label: 'Project',      load: 4,   prepDays: 10, icon: '▲' },
  paper:        { label: 'Paper',        load: 3.5, prepDays: 7,  icon: '✎' },
  presentation: { label: 'Presentation', load: 3,   prepDays: 5,  icon: '◉' },
  quiz:         { label: 'Quiz',         load: 2,   prepDays: 2,  icon: '●' },
  lab:          { label: 'Lab',          load: 1.5, prepDays: 2,  icon: '⚗' },
  assignment:   { label: 'Assignment',   load: 2,   prepDays: 3,  icon: '■' },
  break:        { label: 'No class',     load: 0,   prepDays: 0,  icon: '☾' },
};

// Order matters: the first match wins.
const TYPE_RULES = [
  ['break', /\b(no class(es)?|holiday|recess|thanksgiving|spring break|fall break|reading (day|period)|campus closed|classes cancel+ed)\b/i],
  ['project', /\b(project|capstone|milestone|prototype|demo day|poster)\b/i],
  ['lab', /\blab(oratory)?s?\b/i],
  ['paper', /\b(paper|essays?|report|thesis|rough draft|final draft|draft|write-?up|reflection|annotated bibliography|portfolio)\b/i],
  ['presentation', /\b(presentations?|pitch)\b/i],
  ['exam', /\b(final exam|midterm|mid-term|exam|examination|test\s?\d*|final)\b/i],
  ['quiz', /\bquiz(zes)?\b/i],
  ['assignment', /\b(homework|hw\s?#?\d+|assignment|problem set|pset\s?\d*|ps\s?\d+|due|deliverable|worksheet)\b/i],
];

export function classify(text) {
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type;
  return null;
}

const SEASON_START = { spring: [0, 6], winter: [0, 3], summer: [4, 15], fall: [7, 20], autumn: [7, 20] };

export function detectTerm(text, today = new Date()) {
  const m = text.match(/\b(spring|summer|fall|autumn|winter)\s*(?:term|semester|quarter|session)?\s*'?(\d{4}|\d{2})\b/i);
  if (!m) return { label: null, ref: new Date(today.getFullYear(), today.getMonth(), today.getDate()) };
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  const season = m[1].toLowerCase();
  const [mon, day] = SEASON_START[season];
  return { label: `${cap(season)} ${year}`, ref: new Date(year, mon, day) };
}

export function detectCourse(lines) {
  const head = lines.slice(0, 15);
  for (const line of head) {
    const m = line.match(/\b([A-Z]{2,5})\s?-?\s?(\d{3,4}[A-Z]?)\b/);
    if (m) {
      const code = `${m[1]} ${m[2]}`;
      let title = line.slice(m.index + m[0].length).replace(/^[\s:–—\-|,.]+/, '').replace(/\s*[|(].*$/, '').trim();
      title = title.replace(/\s*[—–\-,]?\s*\b(spring|summer|fall|autumn|winter)\b.*$/i, '').trim();
      return { code, title: title.slice(0, 60) };
    }
  }
  const first = head.find((l) => l.trim().length > 3) || 'Untitled course';
  return { code: first.trim().slice(0, 24), title: '' };
}

// Grading breakdown: "Homework ........ 20%", "Midterm Exam (25%)", "| Final | 30% |"
export function parseGrading(lines) {
  const out = [];
  const clauses = [];
  for (const raw of lines) {
    const l = raw.replace(/\|/g, ' ').trim();
    if ((l.match(/%/g) || []).length > 1) clauses.push(...l.split(/[,;]\s*|\.\s+|\s+and\s+/));
    else clauses.push(l);
  }
  for (const line of clauses) {
    const pcts = [...line.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)];
    if (pcts.length !== 1) continue;
    if (/\b(late|penalty|deduct|reduction|off per|per day|curve|extra credit|bonus)\b/i.test(line)) continue;
    const before = line.slice(0, pcts[0].index);
    if (/\d\s*[-–]\s*$/.test(before) || /[<>≥≤]=?\s*$/.test(before)) continue; // grade scale ranges
    const parts = before.split(':');
    const afterColon = parts.pop();
    const category = (afterColon.trim() ? afterColon : parts.pop() || '').replace(/\([^)]*\)/g, ' ')
      .replace(/\s+(is|are|worth|counts? for|of|weighted)\s*$/i, '').replace(/^\s*[-*•]\s*/, '')
      .replace(/[.…_:=\-–—()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!category || category.length > 42 || /^[A-F][+-]?$/.test(category)) continue;
    if (/^(an?|the|at least|above|below|over|under|minimum)\b/i.test(category)) continue;
    const weight = parseFloat(pcts[0][1]);
    if (weight <= 0 || weight > 100) continue;
    if (out.some((g) => g.category.toLowerCase() === category.toLowerCase())) continue;
    out.push({ category: cap(category), weight });
  }
  return out;
}

function tokens(s) {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => (w.length > 2 || /^\d+$/.test(w)) &&!['the', 'and', 'for', 'due', 'exam', 'exams'].includes(w))
      .map((w) => w.replace(/(zes|s)$/, '')),
  );
}

// Spread each grading category's weight over the items that belong to it.
export function assignWeights(items, grading) {
  if (!grading.length) return items;
  const cats = grading.map((g) => ({ ...g, type: classify(g.category), tok: tokens(g.category), members: [] }));
  for (const it of items) {
    if (it.type === 'break') continue;
    const itTok = tokens(it.title);
    let best = null; let bestScore = 0;
    for (const c of cats) {
      let score = 0;
      for (const t of itTok) if (c.tok.has(t)) score += /^\d+$/.test(t) ? 1 : 2;
      if (c.type === it.type) score += 1;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    const sameType = cats.filter((c) => c.type === it.type);
    if (best && (bestScore >= 2 || sameType.length === 1)) best.members.push(it);
  }
  for (const c of cats) {
    // "Essay 3" (20%) belongs to the item titled "Essay 3 …", not to "Annotated bibliography for Essay 3".
    const name = c.category.toLowerCase();
    const exact = c.members.filter((it) => it.title.toLowerCase().startsWith(name));
    const members = exact.length ? exact : c.members;
    for (const it of members) it.weight = round1(c.weight / members.length);
  }
  return items;
}

export function createParser(chrono) {
  function datesIn(text, ref) {
    return chrono.parse(text, ref, { forwardDate: true })
      .filter((r) => r.start.isCertain('day') && r.start.isCertain('month'))
      .map((r) => ({ text: r.text, index: r.index, date: r.start.date() }));
  }

  function parse(text, opts = {}) {
    const clean = text.replace(/\r/g, '').replace(/\t/g, '  ');
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    const term = detectTerm(clean, opts.today);
    const course = detectCourse(lines);
    const grading = parseGrading(lines);
    const ref = term.ref;
    const min = addDays(ref, -45); const max = addDays(ref, 240);

    const items = [];
    const anchors = new Set(); // every certain date in the text — used to ground AI output
    let ctxDate = null; let ctxAge = 0;

    for (const line of lines) {
      const segments = (line.includes('|') ? line.split('|') : line.split(/(?<=[.!?])\s+(?=[A-Z])/))
        .flatMap((s) => s.split(/\s*;\s*|\s+\/\s+|\s+•\s+/)).map((s) => s.trim()).filter(Boolean);
      const lineDates = datesIn(line, ref).filter((d) => d.date >= min && d.date <= max);
      lineDates.forEach((d) => anchors.add(iso(d.date)));
      const lineDate = lineDates[0] || null;

      let usedAny = false;
      for (const seg of segments) {
        const type = classify(seg);
        const segDates = datesIn(seg, ref).filter((d) => d.date >= min && d.date <= max);
        const d = segDates[0] || lineDate;
        if (type && (d || ctxDate)) {
          const date = d ? d.date : ctxDate;
          let title = seg;
          if (d && seg.includes(d.text)) title = seg.replace(d.text, ' ');
          title = cleanTitle(title, type);
          items.push({ title, type, date: iso(date), source: 'rules', weight: null });
          usedAny = true;
        }
      }
      if (lineDate && !usedAny) { ctxDate = lineDate.date; ctxAge = 0; }
      else if (lineDate) { ctxDate = null; }
      else if (ctxDate && ++ctxAge > 3) ctxDate = null;
    }

    const deduped = dedupe(items);
    assignWeights(deduped, grading);
    deduped.sort((a, b) => a.date.localeCompare(b.date));
    return { course: { ...course, term: term.label }, grading, items: deduped, anchors: [...anchors] };
  }

  return { parse, datesIn };
}

function cleanTitle(s, type) {
  let t = s
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday)?\.?,?\b/gi, ' ')
    .replace(/\bweek\s*\d+\b/gi, ' ')
    .replace(/\b(by|at|before)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ' ')
    .replace(/\b(is|are)?\s*(due|scheduled|held)(\s+(on|by|at))?\b/gi, ' ')
    .replace(/\s(on|by|at)\s*(?=[.,;]|$)/gi, ' ')
    .replace(/[|*#>]+/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—\-,.]+|[\s:–—\-,.(]+$/g, '')
    .replace(/^(your|the|a|an)\s+/i, '')
    .trim();
  if (!t || t.length < 3) t = TYPES[type].label;
  if (t.length > 70) t = t.slice(0, 67).trimEnd() + '…';
  return cap(t);
}

function dedupe(items) {
  const out = [];
  for (const it of items) {
    const dup = out.find((o) => o.date === it.date && o.type === it.type &&
      (o.title.toLowerCase().includes(it.title.toLowerCase()) || it.title.toLowerCase().includes(o.title.toLowerCase())));
    if (dup) { if (it.title.length > dup.title.length) dup.title = it.title; continue; }
    out.push(it);
  }
  return out;
}

export function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function round1(n) { return Math.round(n * 10) / 10; }
