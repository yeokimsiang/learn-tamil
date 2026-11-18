// Validates lesson data: unique ids, references, hooks, images, and coverage of the PDF vocab.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { loadData } from './load-data.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const D = loadData(root); const errs = []; const warn = [];
const ids = new Set();
for (const it of D.items) {
  if (ids.has(it.id)) errs.push('duplicate id ' + it.id); ids.add(it.id);
  if (it.kind === 'word') {
    if (!it.tamil || !it.en) errs.push('word missing tamil/en: ' + it.id);
    if (!it.hooks || it.hooks.length < 2) errs.push('word needs >=2 hooks: ' + it.id);
    if (!it.img && !it.noImg) errs.push('word has no img prompt and no noImg flag: ' + it.id);
    if (it.img && !it.noImg && !fs.existsSync(path.join(root, 'docs/img', it.id + '.webp'))) warn.push('image file missing: ' + it.id);
    if (it.img && !it.noImg && !it.imgWhy) errs.push('picture has no imgWhy explanation: ' + it.id);
    if (it.noImg && it.imgWhy) errs.push('noImg word should not have imgWhy: ' + it.id);
    if (it.set && !D.palaces.find(p => p.id === it.set)) errs.push('unknown palace ' + it.set);
  }
  if (it.kind === 'pattern' && (!it.table || !it.drills || !it.drills.length)) errs.push('pattern incomplete: ' + it.id);
  if (it.kind === 'phrase' && (!it.tamil || !it.en)) errs.push('phrase incomplete: ' + it.id);
}
for (const it of D.items) for (const b of it.buildsOn || []) if (!ids.has(b)) errs.push(`${it.id} buildsOn unknown ${b}`);
// Every "Word-meaning" vocab line in each lesson PDF should be covered by some word's tamil/variants.
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
const known = D.items.filter(i => i.kind === 'word').flatMap(i => [i.tamil, ...(i.variants || [])]).map(norm);
// covered = exact match, or shares a stem with a known word (pudikaadhaa ~ pudikum, onnumille ~ onnum)
const covered = v => known.some(k => k === v || (k.length >= 4 && v.startsWith(k.slice(0, -2))));
const NOT_VOCAB = new Set(['rhyme']);
for (const L of D.lessons) {
  const pdf = path.join(root, `lessons/Tamil_Lesson_${L.n}_Bhavani.pdf`);
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  const vocab = [...txt.matchAll(/^\s*(?:•\s*)?([A-Z][a-z]+)(?:-aa)?\??\s*-\s*\(?[A-Za-z]/gm)].map(m => m[1]).filter(v => !NOT_VOCAB.has(v.toLowerCase()));
  for (const v of vocab) if (!covered(norm(v))) errs.push(`Lesson ${L.n} vocab not covered: ${v}`);
  console.log(`Lesson ${L.n}: ${vocab.length} vocab lines checked`);
}
warn.forEach(w => console.log('warn:', w));
errs.forEach(e => console.log('ERROR:', e));
console.log(`${D.items.length} items, ${errs.length} errors, ${warn.length} warnings`);
process.exit(errs.length ? 1 : 0);
