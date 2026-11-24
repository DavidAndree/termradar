import * as chrono from 'https://cdn.jsdelivr.net/npm/chrono-node@2.7.7/+esm';
import { createParser, assignWeights, TYPES, fromIso, addDays, iso } from './parser.js';
import { aiSupported, aiReady, loadAI, aiExtract, mergeItems, aiCoach, MODEL_ID } from './ai.js';
import { buildIcs, download } from './calendar.js';
import { SAMPLES } from './samples.js';

const parser = createParser(chrono);
const $ = (s, el = document) => el.querySelector(s);
const COLORS = ['#3b82f6', '#f97316', '#a855f7', '#10b981', '#ec4899', '#eab308', '#06b6d4', '#ef4444'];
const STORE = 'termradar:v1';
const HEAVY = new Set(['exam', 'project', 'paper', 'presentation']);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d, o = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(undefined, o);
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

let state = load() || { courses: [], selectedWeek: null, ai: false };

function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } }

/* ---------------- scoring ---------------- */
function itemLoad(it) {
  const t = TYPES[it.type] || TYPES.assignment;
  return t.load * (1 + (it.weight || 0) / 20);
}
function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }

function allItems() {
  return state.courses.flatMap((c) => c.items.map((it) => ({ ...it, course: c.code, courseId: c.id, color: c.color })));
}

function buildWeeks() {
  const items = allItems();
  if (!items.length) return { weeks: [], max: 1 };
  const dates = items.map((i) => fromIso(i.date));
  let start = weekStart(new Date(Math.min(...dates)));
  const end = weekStart(new Date(Math.max(...dates)));
  const weeks = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const key = iso(w);
    const wi = items.filter((i) => iso(weekStart(fromIso(i.date))) === key);
    const graded = wi.filter((i) => i.type !== 'break');
    const per = {};
    for (const c of state.courses) per[c.id] = graded.filter((i) => i.courseId === c.id).reduce((s, i) => s + itemLoad(i), 0);
    const heavyCourses = new Set(graded.filter((i) => HEAVY.has(i.type)).map((i) => i.courseId));
    weeks.push({
      key, start: w, items: wi.sort((a, b) => a.date.localeCompare(b.date)),
      score: graded.reduce((s, i) => s + itemLoad(i), 0), per,
      isBreak: wi.some((i) => i.type === 'break') && !graded.length,
      clash: heavyCourses.size >= 2,
      gradeShare: graded.reduce((s, i) => s + (i.weight || 0), 0),
    });
  }
  const max = Math.max(1, ...weeks.map((w) => w.score));
  return { weeks, max };
}
const level = (score, max) => (score <= 0 ? 0 : Math.min(4, Math.ceil((score / max) * 4)));

/* ---------------- intake ---------------- */
async function readFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (!window.pdfjsLib) throw new Error('PDF reader is still loading — try again in a second.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      let lastY = null;
      for (const it of tc.items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
        else if (out && !/\s$/.test(out)) out += ' ';
        out += it.str;
        lastY = y;
        if (it.hasEOL) { out += '\n'; lastY = null; }
      }
      out += '\n';
    }
    return out;
  }
  return file.text();
}

async function analyze(sources) {
  const btn = $('#btn-analyze');
  btn.disabled = true; btn.textContent = 'Scanning…';
  let aiStats = { verified: 0, added: 0, rejected: 0 };
  let total = 0;
  try {
    const useAI = $('#ai-toggle').checked;
    if (useAI) await ensureAI();
    for (const src of sources) {
      const res = parser.parse(src.text);
      let items = res.items;
      if (useAI && aiReady()) {
        setProgress(1, `AI reading ${res.course.code}…`);
        const ai = await aiExtract(src.text, { term: res.course.term, anchors: res.anchors },
          (i, n) => setProgress(i / n, `AI reading ${res.course.code} · part ${i} of ${n}`));
        items = mergeItems(items, ai.items);
        items.forEach((it) => { it.weight = null; });
        assignWeights(items, res.grading);
        aiStats.verified += items.filter((i) => i.source === 'verified').length;
        aiStats.added += items.filter((i) => i.source === 'ai').length;
        aiStats.rejected += ai.rejected;
        $('#ai-progress').hidden = true;
      }
      if (!items.length) { toast(`No dated deadlines found in ${src.name || 'that text'}. Check that it includes a schedule.`); continue; }
      const existing = state.courses.find((c) => c.code === res.course.code);
      if (existing) state.courses = state.courses.filter((c) => c !== existing);
      state.courses.push({
        id: uid(), code: res.course.code, title: res.course.title, term: res.course.term,
        color: COLORS[state.courses.length % COLORS.length],
        grading: res.grading.map((g) => ({ ...g, score: '' })), target: 90,
        items: items.map((i) => ({ ...i, id: uid(), done: false })),
      });
      total += items.filter((i) => i.type !== 'break').length;
    }
    if (!state.courses.length) return;
    const { weeks } = buildWeeks();
    const worst = [...weeks].sort((a, b) => b.score - a.score)[0];
    state.selectedWeek = worst?.key ?? null;
    animateNext = true;
    save(); render();
    $('#paste').value = '';
    const aiMsg = $('#ai-toggle').checked && aiReady()
      ? ` · AI verified ${aiStats.verified}, added ${aiStats.added}, blocked ${aiStats.rejected} unsupported date${aiStats.rejected === 1 ? '' : 's'}` : '';
    toast(`Found ${total} deadlines across ${sources.length} syllabus${sources.length === 1 ? '' : 'es'}${aiMsg}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong while reading that syllabus.');
  } finally {
    btn.disabled = false; btn.textContent = 'Scan syllabus';
  }
}

function setProgress(p, text) {
  const el = $('#ai-progress'); el.hidden = false;
  $('.bar', el).style.width = `${Math.round(p * 100)}%`;
  $('.ptext', el).textContent = text;
}
async function ensureAI() {
  if (aiReady()) return;
  setProgress(0, 'Downloading on-device model (first time only)…');
  try {
    await loadAI((p, text) => setProgress(p, text.replace(/\[.*?\]\s*/, '') || 'Loading model…'));
    setProgress(1, `On-device AI ready · ${MODEL_ID.split('-q')[0]}`);
    setTimeout(() => { $('#ai-progress').hidden = true; }, 1500);
  } catch (e) {
    $('#ai-toggle').checked = false; state.ai = false; save();
    $('#ai-progress').hidden = true;
    toast(`AI unavailable (${e.message}). Using the rule engine instead.`);
  }
}

/* ---------------- render ---------------- */
function render() {
  const has = state.courses.length > 0;
  $('#dash').hidden = !has;
  $('#intake').hidden = has && !state.showIntake;
  $('#btn-export').hidden = !has;
  $('#btn-add').hidden = !has;
  $('#btn-add').textContent = state.showIntake ? 'Back to radar' : '+ Add syllabus';
  if (!has) return;
  const { weeks, max } = buildWeeks();
  if (!weeks.find((w) => w.key === state.selectedWeek)) state.selectedWeek = weeks[0]?.key;
  renderStats(weeks);
  renderHeat(weeks, max);
  renderWeek(weeks.find((w) => w.key === state.selectedWeek), max);
  renderNext();
  renderCourses();
}

function renderStats(weeks) {
  const items = allItems().filter((i) => i.type !== 'break');
  const worst = [...weeks].sort((a, b) => b.score - a.score)[0];
  const clashes = weeks.filter((w) => w.clash).length;
  const soon = items.filter((i) => { const d = fromIso(i.date); return d >= TODAY && d <= addDays(TODAY, 14) && !i.done; }).length;
  const exams = items.filter((i) => i.type === 'exam').length;
  $('#stats').innerHTML = [
    stat('Deadlines found', items.length, `${state.courses.length} course${state.courses.length === 1 ? '' : 's'} · ${exams} exams`),
    stat('Worst week', worst ? `Wk of ${fmt(worst.start)}` : '—', worst ? `${worst.items.filter((i) => i.type !== 'break').length} items · ${Math.round(worst.gradeShare)}% of grades` : '', true),
    stat('Collision weeks', clashes, 'major work in 2+ courses at once'),
    stat('Due in next 14 days', soon, soon ? 'start now' : 'you’re clear for now'),
  ].join('');
  if (animateNext) document.querySelectorAll('#stats .v').forEach((el) => countUp(el, el.dataset.v));
}
const stat = (k, v, d, hot) => `<div class="stat card${hot ? ' hot' : ''}"><div class="k">${k}</div><div class="v" data-v="${esc(v)}">${esc(v)}</div><div class="d">${esc(d)}</div></div>`;

function renderHeat(weeks, max) {
  const heat = $('#heat');
  heat.style.gridTemplateColumns = `auto repeat(${weeks.length}, minmax(30px, 1fr))`;
  const nowKey = iso(weekStart(TODAY));
  let html = '<div></div>' + weeks.map((w) => `<div class="colhead${w.key === nowKey ? ' now' : ''}">${fmt(w.start, { month: 'numeric', day: 'numeric' })}</div>`).join('');
  let idx = 0;
  for (const c of state.courses) {
    html += `<div class="rowlabel"><span class="dot" style="background:${c.color}"></span>${esc(c.code)}</div>`;
    html += weeks.map((w, k) => {
      idx = k + state.courses.indexOf(c) * 4;
      const s = w.per[c.id] || 0;
      const brk = !s && w.items.some((i) => i.courseId === c.id && i.type === 'break');
      const n = w.items.filter((i) => i.courseId === c.id && i.type !== 'break').length;
      return `<button class="cell l${level(s, max)}${brk ? ' brk' : ''}${w.key === state.selectedWeek ? ' sel' : ''}" style="--i:${idx}" data-week="${w.key}" data-cid="${c.id}" aria-label="${esc(c.code)}, week of ${fmt(w.start)}: ${n} item${n === 1 ? '' : 's'}${brk ? ', no class' : ''}">${n > 1 ? n : ''}</button>`;
    }).join('');
  }
  html += '<div class="rowlabel total">All courses</div>' + weeks.map((w, k) => {
    const n = w.items.filter((i) => i.type !== 'break').length;
    return `<button class="cell total l${level(w.score, max)}${w.isBreak ? ' brk' : ''}${w.key === state.selectedWeek ? ' sel' : ''}" style="--i:${k + state.courses.length * 4}" data-week="${w.key}" aria-label="Week of ${fmt(w.start)}: ${n} items${w.clash ? ', collision' : ''}">${n || ''}${w.clash ? '<span class="clash"></span>' : ''}</button>`;
  }).join('');
  heat.innerHTML = html;
  heat.classList.toggle('static', !animateNext);
  if (animateNext) { const card = heat.closest('.radar-card'); card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
  animateNext = false;
  lastWeeks = weeks;
  // Safety net: if animations never run (background tab, throttled renderer), still show everything.
  clearTimeout(renderHeat.settle);
  renderHeat.settle = setTimeout(() => { heat.classList.add('static'); $('#week-card').classList.add('static'); }, 1600);
}
let animateNext = true;
let lastWeeks = [];

/* hover preview for heatmap cells */
function showTip(cell) {
  const w = lastWeeks.find((x) => x.key === cell.dataset.week); if (!w) return;
  const cid = cell.dataset.cid;
  const items = w.items.filter((i) => !cid || i.courseId === cid);
  const tip = $('#tip');
  tip.innerHTML = `<h4>Week of ${fmt(w.start)}${w.clash && !cid ? '<small>⚠ collision</small>' : ''}</h4>${items.length
    ? `<ul>${items.map((i) => `<li><i style="background:${i.color}"></i>${esc(i.title)}<em>${i.type === 'break' ? 'no class' : fmt(fromIso(i.date), { weekday: 'short' })}</em></li>`).join('')}</ul>`
    : '<span class="sub">Nothing due</span>'}`;
  tip.hidden = false;
  const r = cell.getBoundingClientRect(); const tr = tip.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2; x = Math.max(8, Math.min(innerWidth - tr.width - 8, x));
  let y = r.top - tr.height - 10; if (y < 70) y = r.bottom + 10;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}

function countUp(el, to) {
  const n = parseInt(to, 10);
  if (isNaN(n) || String(n) !== String(to) || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const t0 = performance.now(); const dur = 700;
  const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function buildPreview() {
  const g = $('#preview-grid'); if (!g) return;
  const rows = [['CS', '0102102200231002'], ['PHYS', '1010201030112004'], ['ENGL', '0201002020130204'], ['ALL', '1213212041243114']];
  let html = ''; let i = 0;
  for (const [name, pat] of rows) {
    html += `<span>${name}</span>`;
    for (const ch of pat) html += `<b class="l${ch}" style="--i:${i++}"></b>`;
  }
  g.innerHTML = html;
}

function renderWeek(w, max) {
  const card = $('#week-card'); card.classList.remove('static');
  if (!w) { card.innerHTML = '<p class="empty">Pick a week on the radar.</p>'; return; }
  const end = addDays(w.start, 6);
  const graded = w.items.filter((i) => i.type !== 'break');
  const lvl = level(w.score, max);
  const tag = w.isBreak ? '<span class="pill ok">☾ Break week</span>'
    : w.clash ? '<span class="pill hot">⚠ Collision week</span>'
    : lvl >= 3 ? '<span class="pill hot">Heavy week</span>' : graded.length ? '<span class="pill ok">Manageable</span>' : '<span class="pill">Free week</span>';
  const plan = graded
    .map((i) => ({ ...i, startBy: addDays(fromIso(i.date), -(TYPES[i.type].prepDays)) }))
    .sort((a, b) => a.startBy - b.startBy || (b.weight || 0) - (a.weight || 0));
  card.innerHTML = `
    <div class="wk-title"><h2>Week of ${fmt(w.start)} – ${fmt(end)}</h2>${tag}</div>
    <p class="sub">${graded.length} graded item${graded.length === 1 ? '' : 's'} · ${Math.round(w.gradeShare)}% of your total grades combined</p>
    <ul class="items">${w.items.map(itemRow).join('') || '<li class="empty">Nothing due. Use it to get ahead.</li>'}</ul>
    ${graded.length ? `
    <div class="plan">
      <h3><span>Prep plan</span>${coachButton()}</h3>
      <ol>${plan.map((i) => `<li><span class="startby">Start ${fmt(i.startBy, { weekday: 'short', month: 'short', day: 'numeric' })}</span> → ${esc(i.title)} <span class="sub">(${esc(i.course)}${i.weight ? `, ${i.weight}%` : ''})</span></li>`).join('')}</ol>
      <div class="coach" id="coach" hidden></div>
    </div>` : ''}`;
}
function coachButton() {
  if (!aiSupported()) return '<span class="pill" title="Your browser has no WebGPU">AI coach needs Chrome/Edge with WebGPU</span>';
  return `<button class="btn small" id="btn-coach">✨ ${aiReady() ? 'Ask AI coach' : 'Load AI coach'}</button>`;
}
function itemRow(i) {
  const d = fromIso(i.date);
  const t = TYPES[i.type] || TYPES.assignment;
  return `<li class="item${i.done ? ' done' : ''}" style="--c:${i.color};--w:${Math.min(100, (i.weight || 0) * 3)}"${i.weight ? ' data-w' : ''}>
    <div class="when">${fmt(d, { weekday: 'short' })}<b>${d.getDate()}</b></div>
    <div class="what"><strong>${esc(i.title)}</strong><span>${t.icon} ${t.label} · ${esc(i.course)}</span></div>
    <div class="wt">${i.weight ? `${i.weight}%` : ''}</div></li>`;
}

function renderNext() {
  const up = allItems().filter((i) => i.type !== 'break' && !i.done && fromIso(i.date) >= TODAY)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const heavy = allItems().filter((i) => i.type !== 'break').sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 1)[0];
  $('#next-card').innerHTML = `
    <div class="wk-title"><h2>Up next</h2>${heavy?.weight ? `<span class="pill">Biggest: ${esc(heavy.title)} · ${heavy.weight}%</span>` : ''}</div>
    <ul class="items">${up.map((i) => {
      const days = Math.round((fromIso(i.date) - TODAY) / 864e5);
      return itemRow({ ...i, title: `${i.title}` }).replace('</span></div>', ` · in ${days} day${days === 1 ? '' : 's'}</span></div>`);
    }).join('') || '<li class="empty">Nothing upcoming. 🎉</li>'}</ul>`;
}

function renderCourses() {
  $('#courses').innerHTML = state.courses.map((c) => {
    const graded = c.items.filter((i) => i.type !== 'break');
    const gsum = c.grading.reduce((s, g) => s + g.weight, 0);
    const gcolors = ['var(--accent)', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#eab308', '#06b6d4'];
    return `<article class="course card" data-cid="${c.id}">
      <div class="course-head">
        <div><h3><span class="dot" style="background:${c.color}"></span>${esc(c.code)}</h3>
        <p>${esc(c.title || 'Untitled course')}${c.term ? ` · ${esc(c.term)}` : ''} · ${graded.length} deadlines</p></div>
        <button class="xbtn" data-act="remove-course" aria-label="Remove ${esc(c.code)}">✕</button>
      </div>
      ${c.grading.length ? `<div class="gbar" title="Grading breakdown">${c.grading.map((g, k) => `<span style="width:${(g.weight / Math.max(gsum, 100)) * 100}%;background:${gcolors[k % gcolors.length]}"></span>`).join('')}</div>
      <div class="gkeys">${c.grading.map((g, k) => `<span><i style="background:${gcolors[k % gcolors.length]}"></i>${esc(g.category)} ${g.weight}%</span>`).join('')}${Math.round(gsum) !== 100 ? `<span class="sub">(totals ${Math.round(gsum)}%)</span>` : ''}</div>`
      : '<p class="sub">No grading breakdown found in this syllabus.</p>'}
      <details><summary>Review &amp; edit deadlines</summary>
        <table class="etable"><tbody>${c.items.map((i) => `<tr data-iid="${i.id}">
          <td class="c-date"><input type="date" value="${i.date}" data-f="date" aria-label="Date"></td>
          <td><input value="${esc(i.title)}" data-f="title" aria-label="Title"></td>
          <td class="c-type"><select data-f="type" aria-label="Type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === i.type ? ' selected' : ''}>${t.label}</option>`).join('')}</select></td>
          <td class="c-w"><input type="number" min="0" max="100" step="0.1" value="${i.weight ?? ''}" placeholder="%" data-f="weight" aria-label="Weight percent"></td>
          <td class="c-src src"><span class="badge ${i.source}" title="${srcTitle(i.source)}">${i.source}</span></td>
          <td class="c-x"><button class="xbtn" data-act="del-item" aria-label="Delete">✕</button></td></tr>`).join('')}</tbody></table>
        <button class="btn small" data-act="add-item" style="margin-top:10px">+ Add deadline</button>
      </details>
      ${c.grading.length ? `<details class="calc-d"><summary>What do I need on the rest?</summary>${calcHtml(c)}</details>` : ''}
    </article>`;
  }).join('');
}
const srcTitle = (s) => ({ rules: 'Found by the rule engine', ai: 'Proposed by on-device AI; date confirmed in syllabus text', verified: 'Found by both the AI and the rule engine', manual: 'Added or edited by you' }[s] || '');

function calcHtml(c) {
  const graded = c.grading.filter((g) => g.score !== '' && g.score != null && !isNaN(parseFloat(g.score)));
  const doneW = graded.reduce((s, g) => s + g.weight, 0);
  const earned = graded.reduce((s, g) => s + g.weight * parseFloat(g.score) / 100, 0);
  const totalW = c.grading.reduce((s, g) => s + g.weight, 0) || 100;
  const remainW = totalW - doneW;
  const target = parseFloat(c.target) * totalW / 100;
  let out;
  if (!graded.length) out = '<div class="calc-out">Enter the scores you have so far — leave the rest blank.</div>';
  else if (remainW <= 0) { const fin = (earned / totalW) * 100; out = `<div class="calc-out ${fin >= c.target ? 'good' : 'bad'}">Final grade: <b>${fin.toFixed(1)}%</b></div>`; }
  else {
    const need = ((target - earned) / remainW) * 100;
    const cur = (earned / doneW) * 100;
    out = need > 100 ? `<div class="calc-out bad">You'd need <b>${need.toFixed(1)}%</b> on the remaining ${remainW}% — out of reach. Talk to your instructor about options.</div>`
      : need <= 0 ? `<div class="calc-out good">Already locked in. <b>${c.target}%</b> is safe even with zeros on the rest.</div>`
      : `<div class="calc-out ${need <= cur ? 'good' : 'bad'}">Average <b>${need.toFixed(1)}%</b> on the remaining ${remainW}% to finish at ${c.target}%. <span class="sub">You're averaging ${cur.toFixed(1)}% so far.</span></div>`;
  }
  return `<div class="calc">
    ${c.grading.map((g, k) => `<div class="calc-row"><label for="g-${c.id}-${k}">${esc(g.category)}</label><span class="w">${g.weight}%</span><input id="g-${c.id}-${k}" type="number" min="0" max="120" step="0.1" placeholder="score %" value="${esc(g.score)}" data-g="${k}"></div>`).join('')}
    <div class="calc-row"><label for="t-${c.id}">Target final grade</label><span></span><select id="t-${c.id}" data-target>${[[93, 'A (93)'], [90, 'A− (90)'], [87, 'B+ (87)'], [83, 'B (83)'], [80, 'B− (80)'], [73, 'C (73)'], [70, 'C− (70)']].map(([v, l]) => `<option value="${v}"${+c.target === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="calc-result">${out}</div></div>`;
}

/* ---------------- events ---------------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4200);
}

function bind() {
  const drop = $('#drop'); const file = $('#file');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  file.addEventListener('change', () => { handleFiles(file.files); file.value = ''; });

  $('#btn-analyze').addEventListener('click', () => {
    const text = $('#paste').value.trim();
    if (text.length < 40) { toast('Paste a syllabus or drop a file first.'); $('#paste').focus(); return; }
    state.showIntake = false;
    analyze([{ name: 'pasted text', text }]);
  });
  $('#btn-sample').addEventListener('click', () => { state.showIntake = false; analyze(SAMPLES); });

  const toggle = $('#ai-toggle');
  toggle.checked = !!state.ai && aiSupported();
  if (!aiSupported()) { $('#ai-hint').textContent = '(not supported in this browser: needs WebGPU, e.g. Chrome or Edge)'; toggle.disabled = true; }
  toggle.addEventListener('change', () => { state.ai = toggle.checked; save(); if (toggle.checked) ensureAI(); });

  $('#btn-export').addEventListener('click', () => {
    download('termradar-deadlines.ics', buildIcs(state.courses));
    toast('Calendar file downloaded. Open it to import into Google, Apple or Outlook Calendar.');
  });
  $('#btn-add').addEventListener('click', () => { state.showIntake = !state.showIntake; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirmInline($('#btn-reset'))) return;
    state = { courses: [], selectedWeek: null, ai: state.ai }; save(); render();
  });
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('termradar:theme', next); } catch {}
  });

  $('#heat').addEventListener('pointerover', (e) => { const c = e.target.closest('.cell'); if (c && e.pointerType !== 'touch') showTip(c); });
  $('#heat').addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.cell')) $('#tip').hidden = true; });
  $('#heat').addEventListener('focusin', (e) => { const c = e.target.closest('.cell'); if (c) showTip(c); });
  $('#heat').addEventListener('focusout', () => { $('#tip').hidden = true; });
  addEventListener('scroll', () => { $('#tip').hidden = true; }, { passive: true });
  $('#heat').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-week]'); if (!cell) return;
    state.selectedWeek = cell.dataset.week; save(); render();
    if (innerWidth < 960) $('#week-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#week-card').addEventListener('click', async (e) => {
    if (!e.target.closest('#btn-coach')) return;
    const btn = e.target.closest('#btn-coach'); const box = $('#coach');
    btn.disabled = true;
    try {
      if (!aiReady()) { btn.textContent = 'Loading model…'; await loadAI((p) => { btn.textContent = `Loading model… ${Math.round(p * 100)}%`; }); }
      btn.textContent = 'Thinking…';
      const w = buildWeeks().weeks.find((x) => x.key === state.selectedWeek);
      box.hidden = false; box.textContent = ''; box.classList.add('caret');
      const ol = box.parentElement.querySelector('ol'); if (ol) ol.hidden = true;
      for await (const tok of aiCoach(`${fmt(w.start)} – ${fmt(addDays(w.start, 6))}`, w.items.filter((i) => i.type !== 'break'), fmt(TODAY, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))) {
        box.textContent += tok;
      }
      btn.textContent = '✨ Ask again';
    } catch (err) {
      box.hidden = false; box.textContent = `AI coach unavailable: ${err.message}`;
      btn.textContent = '✨ Try again';
    } finally { box.classList.remove('caret'); btn.disabled = false; }
  });

  const courses = $('#courses');
  courses.addEventListener('change', (e) => {
    const card = e.target.closest('[data-cid]'); if (!card) return;
    const c = state.courses.find((x) => x.id === card.dataset.cid);
    const row = e.target.closest('[data-iid]');
    if (row) {
      const it = c.items.find((x) => x.id === row.dataset.iid);
      const f = e.target.dataset.f;
      if (f === 'weight') it.weight = e.target.value === '' ? null : parseFloat(e.target.value);
      else if (f === 'date') { if (!e.target.value) return; it.date = e.target.value; }
      else it[f] = e.target.value;
      it.source = 'manual';
      c.items.sort((a, b) => a.date.localeCompare(b.date));
      save(); keepOpen(() => render(), c.id);
      return;
    }
    if (e.target.dataset.g !== undefined) c.grading[+e.target.dataset.g].score = e.target.value;
    if (e.target.dataset.target !== undefined) c.target = +e.target.value;
    save();
    card.querySelector('.calc-result').innerHTML = calcHtml(c).match(/<div class="calc-result">([\s\S]*)<\/div><\/div>$/)[1];
  });
  courses.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const card = e.target.closest('[data-cid]');
    const c = state.courses.find((x) => x.id === card.dataset.cid);
    if (act === 'remove-course') {
      if (!confirmInline(e.target.closest('button'))) return;
      state.courses = state.courses.filter((x) => x !== c);
    }
    if (act === 'del-item') c.items = c.items.filter((x) => x.id !== e.target.closest('[data-iid]').dataset.iid);
    if (act === 'add-item') c.items.push({ id: uid(), title: 'New deadline', type: 'assignment', date: iso(TODAY), weight: null, source: 'manual', done: false });
    save(); keepOpen(() => render(), c?.id);
  });
}

// Two-step confirm without a blocking dialog.
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = btn.classList.contains('xbtn') ? 'Sure?' : 'Click again to confirm';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 2500);
  return false;
}
function keepOpen(fn, cid) {
  const open = [...document.querySelectorAll(`[data-cid="${cid}"] details`)].map((d) => d.open);
  fn();
  document.querySelectorAll(`[data-cid="${cid}"] details`).forEach((d, k) => { d.open = !!open[k]; });
}

async function handleFiles(list) {
  const files = [...list]; if (!files.length) return;
  try {
    const sources = [];
    for (const f of files) sources.push({ name: f.name, text: await readFile(f) });
    state.showIntake = false;
    await analyze(sources);
  } catch (e) { toast(e.message); }
}

buildPreview();
bind();
render();
