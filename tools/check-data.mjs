// Validates lesson data: unique ids, references, hooks, pictures, Tamil script,
// drill gating, and coverage of every vocab line in the lesson PDFs.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { loadData } from './load-data.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const D = loadData(root); const errs = []; const warn = [];
const ids = new Set();
for (const it of D.items) { if (ids.has(it.id)) errs.push('duplicate id ' + it.id); ids.add(it.id); }
const byId = Object.fromEntries(D.items.map(i => [i.id, i]));
for (const it of D.items) {
  if (it.kind === 'word') {
    for (const f of ['tamil', 'en', 'ta', 'cat', 'sound', 'meaning', 'see', 'pron']) if (!it[f]) errs.push(`word ${it.id} missing ${f}`);
    if (!it.alts || !it.alts.length) errs.push('word needs at least one alternate hook: ' + it.id);
    if (it.cat && !(D.cats || {})[it.cat]) errs.push(`word ${it.id} unknown cat ${it.cat}`);
    const hasFile = fs.existsSync(path.join(root, 'docs/img', it.id + '.webp'));
    if (!it.noImg && !hasFile) errs.push('picture file missing (set noImg if intended): ' + it.id);
    if (it.noImg && hasFile) warn.push('noImg word still has a picture file: ' + it.id);
    if (it.picNote && it.noImg) errs.push('picNote on a word without a picture: ' + it.id);
    if (it.set && !D.palaces.find(p => p.id === it.set)) errs.push('unknown palace ' + it.set);
    if (it.holdUntil && !(byId[it.holdUntil] && byId[it.holdUntil].kind === 'word')) errs.push(`${it.id} holdUntil must be a word: ${it.holdUntil}`);
  }
  if (it.kind === 'pattern') {
    if (!it.table || !it.drills || !it.drills.length) errs.push('pattern incomplete: ' + it.id);
    for (const d of it.drills || []) {
      if (!Array.isArray(d[2])) errs.push(`${it.id} drill "${d[0]}" missing needs list`);
      for (const n of d[2] || []) if (!ids.has(n)) errs.push(`${it.id} drill needs unknown ${n}`);
      // a drill whose answer is exactly a word card would duplicate it
      if (D.items.some(w => w.kind === 'word' && w.tamil === d[1])) errs.push(`${it.id} drill duplicates word card: ${d[1]}`);
    }
  }
  if (it.kind === 'phrase' && (!it.tamil || !it.en || !it.ta)) errs.push('phrase incomplete: ' + it.id);
}
for (const it of D.items) for (const b of it.buildsOn || []) if (!ids.has(b)) errs.push(`${it.id} buildsOn unknown ${b}`);
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
// words, their variants, and every form a pattern teaches (table cells and drill answers)
const patternForms = D.items.filter(i => i.kind === 'pattern').flatMap(p => [...p.table.slice(1).flat(), ...p.drills.map(d => d[1])])
  .flatMap(c => String(c).split(/[:\/,;()]|\s+/)).filter(w => /^[a-z]{3,}$/i.test(w));
const known = D.items.filter(i => i.kind === 'word').flatMap(i => [i.tamil, ...(i.variants || [])]).concat(patternForms).map(norm);
// covered = exact match, or shares a stem with a known word (pudikaadhaa ~ pudikum, onnumille ~ onnum)
const covered = v => known.some(k => k === v || (k.length >= 4 && v.startsWith(k.slice(0, -2))));
// English words that happen to sit on the left of a 'word - meaning' line in the slides
const NOT_VOCAB = new Set(['rhyme', 'strawberry', 'mine', 'yours', 'his', 'hers', 'its', 'ours', 'head', 'chest', 'eyebrows', 'lips', 'exception', 'ku', 'la', 'story']);
for (const L of D.lessons) {
  const pdf = path.join(root, `lessons/Tamil_Lesson_${L.n}_Bhavani.pdf`);
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  const vocab = [...txt.matchAll(/^\s*(?:•\s*)?([A-Z][a-z]+)(?:-aa)?\??\s*-\s*\(?[A-Za-z]/gm)].map(m => m[1]).filter(v => !NOT_VOCAB.has(v.toLowerCase()));
  for (const v of vocab) if (!covered(norm(v))) errs.push(`Lesson ${L.n} vocab not covered: ${v}`);
  console.log(`Lesson ${L.n}: ${vocab.length} vocab lines checked`);
}
warn.forEach(w => console.log('warn:', w));
errs.forEach(e => console.log('ERROR:', e));
const words = D.items.filter(i => i.kind === 'word');
console.log(`${D.items.length} items (${words.length} words, ${words.filter(w => !w.noImg).length} with pictures), ${errs.length} errors, ${warn.length} warnings`);
process.exit(errs.length ? 1 : 0);
