import * as chrono from 'chrono-node';
import { createParser } from '../js/parser.js';
import { SAMPLES } from '../js/samples.js';
const p = createParser(chrono);
for (const s of SAMPLES) {
  const r = p.parse(s.text);
  console.log('\n##', r.course.code, '|', r.course.title, '|', r.course.term);
  console.log('grading:', r.grading.map(g => `${g.category}=${g.weight}`).join(', '));
  for (const it of r.items) console.log(' ', it.date, it.type.padEnd(12), (it.weight ?? '-') + '%', it.title);
}
