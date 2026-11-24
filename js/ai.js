// On-device AI via WebLLM (WebGPU). Nothing leaves the browser: the model weights are
// downloaded once from Hugging Face, cached, and inference runs on the user's GPU.
import { classify, TYPES } from './parser.js';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const TYPE_KEYS = Object.keys(TYPES);

let engine = null;
let loading = null;

export function aiSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export function aiReady() { return !!engine; }

export async function loadAI(onProgress = () => {}) {
  if (engine) return engine;
  if (!aiSupported()) throw new Error('WebGPU is not available in this browser.');
  if (!loading) {
    loading = (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No compatible GPU adapter found.');
      const webllm = await import(WEBLLM_URL);
      engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (r) => onProgress(r.progress ?? 0, r.text ?? ''),
      });
      return engine;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: TYPE_KEYS },
          date: { type: 'string' },
        },
        required: ['title', 'type', 'date'],
      },
    },
  },
  required: ['items'],
};

function chunk(text, size = 2200) {
  const paras = text.split(/\n(?=\S)/);
  const out = []; let cur = '';
  for (const p of paras) {
    if ((cur + '\n' + p).length > size && cur) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (c.length > size * 1.5 ? c.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) : [c]));
}

/**
 * AI proposes, rules verify: the model reads the syllabus and proposes graded items,
 * but an item is only accepted if its date is one that literally appears in the text
 * (the rule parser's "anchors"). This blocks hallucinated deadlines.
 */
export async function aiExtract(text, { term, anchors }, onStep = () => {}) {
  const eng = await loadAI();
  const anchorSet = new Set(anchors);
  const year = term?.match(/\d{4}/)?.[0] ?? new Date().getFullYear();
  const parts = chunk(text);
  const found = [];
  let rejected = 0;
  for (let i = 0; i < parts.length; i++) {
    onStep(i + 1, parts.length);
    const res = await eng.chat.completions.create({
      temperature: 0,
      max_tokens: 900,
      response_format: { type: 'json_object', schema: JSON.stringify(SCHEMA) },
      messages: [
        { role: 'system', content: `You extract every graded deadline and exam from a university course syllabus.
Term: ${term || 'unknown'}; dates without a year are in ${year} (or the following year for January–May after a fall term).
Return JSON. For each item give a short clear title (e.g. "Homework 3", "Midterm exam", "Essay 2: rhetorical analysis"),
a type from: ${TYPE_KEYS.join(', ')}, and the date as YYYY-MM-DD. Use type "break" for days with no class.
Skip lecture topics and readings that are not graded. Never invent dates that are not in the text.` },
        { role: 'user', content: parts[i] },
      ],
    });
    let parsed;
    try { parsed = JSON.parse(res.choices[0].message.content); } catch { continue; }
    for (const it of parsed.items || []) {
      if (!it || typeof it.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) { rejected++; continue; }
      if (!anchorSet.has(it.date)) { rejected++; continue; }
      const type = TYPE_KEYS.includes(it.type) ? it.type : (classify(it.title) || 'assignment');
      found.push({ title: it.title.trim().slice(0, 70), type, date: it.date, source: 'ai', weight: null });
    }
  }
  return { items: found, rejected };
}

// Merge AI items into rule items. Agreement upgrades the source badge to "verified".
export function mergeItems(ruleItems, aiItems) {
  const out = ruleItems.map((r) => ({ ...r }));
  for (const a of aiItems) {
    const match = out.find((r) => r.date === a.date && (r.type === a.type || r.source === 'rules' && sameish(r.title, a.title)));
    if (match) {
      match.source = 'verified';
      if (a.title.length >= 4 && a.title.length <= 60 && match.title.length > 40) match.title = a.title;
    } else if (!out.some((r) => r.date === a.date && sameish(r.title, a.title))) {
      out.push(a);
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function sameish(a, b) {
  const t = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) || []);
  const A = t(a); const B = t(b);
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n >= Math.min(2, Math.min(A.size, B.size));
}

// Streaming study-coach plan for one crunch week.
export async function* aiCoach(weekLabel, items) {
  const eng = await loadAI();
  const day = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
  const back = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  // Code owns the schedule (dates, order); the model writes one specific tactic per deadline.
  const plan = items
    .map((it) => ({ ...it, start: back(it.date, TYPES[it.type].prepDays) }))
    .sort((a, b) => a.start.localeCompare(b.start) || (b.weight || 0) - (a.weight || 0));
  const others = (it) => plan.filter((p) => p !== it).map((p) => `${p.course} ${p.title} due ${day(p.date)}`).join('; ') || 'none';
  for (const it of plan) {
    yield `• ${day(it.start)} → ${it.course} ${it.title}${it.weight ? ` (${it.weight}%)` : ''}\n   `;
    const stream = await eng.chat.completions.create({
      stream: true,
      temperature: 0.4,
      max_tokens: 60,
      messages: [
        { role: 'system', content: 'You are a study coach. Reply with ONE sentence under 25 words: a concrete, specific way to prepare for this deadline, mentioning how to fit it around the other deadlines that week. No preamble, no lists.' },
        { role: 'user', content: `${TYPES[it.type].label}: ${it.course} "${it.title}" due ${day(it.date)}${it.weight ? `, worth ${it.weight}% of the grade` : ''}. Prep starts ${day(it.start)}. Same week: ${others(it)}.` },
      ],
    });
    let n = 0;
    for await (const part of stream) {
      const t = (part.choices[0]?.delta?.content ?? '').replace(/\n+/g, ' ');
      if (!n && !t.trim()) continue;
      n += t.length; yield t;
    }
    yield '\n';
  }
}
