// One-off image generator. Usage: node tools/gen_images.mjs [id ...] [--seed N]
// Fetches a rough B&W sketch per word from the free Pollinations endpoint, then
// tools/process_image.py crops the watermark, greyscales and saves docs/img/<id>.webp.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { loadData } from './load-data.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const seedIdx = args.indexOf('--seed'); const seed = seedIdx >= 0 ? args.splice(seedIdx, 2)[1] : '11';
const force = args.includes('--force'); const ids = args.filter(a => !a.startsWith('--'));
const STYLE = 'simple black and white cartoon doodle, thick black ink outlines, white background, minimal, funny, no text, no words, no letters: ';
const rawDir = path.join(root, 'tools/.raw'); fs.mkdirSync(rawDir, { recursive: true });
const items = loadData(root).items.filter(i => i.img && (ids.length ? ids.includes(i.id) : true));
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const it of items) {
  const outDir = process.env.IMG_OUT || path.join(root, 'docs/img'); fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, it.id + '.webp');
  if (!ids.length && !force && fs.existsSync(path.join(root, 'docs/img', it.id + '.webp'))) continue;
  if (fs.existsSync(out) && !force && !ids.length) continue;
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(STYLE + it.img) +
    `?width=512&height=512&seed=${seed}&nologo=true`;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
        const raw = path.join(rawDir, it.id + '.jpg');
        fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        execFileSync('python3', ['-I', path.join(root, 'tools/process_image.py'), raw, out]);
        console.log('ok', it.id); break;
      }
      console.log('retry', it.id, res.status); await sleep(15000 * attempt);
    } catch (e) { console.log('err', it.id, e.message); await sleep(15000 * attempt); }
  }
  await sleep(4000);
}
