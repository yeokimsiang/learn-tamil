// Loads docs/data/*.js (browser scripts) into Node and returns window.TAMIL.
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
export function loadData(root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')) {
  const ctx = { window: {} }; vm.createContext(ctx);
  const dir = path.join(root, 'docs/data');
  for (const f of fs.readdirSync(dir).filter(f => /^lesson\d+\.js$/.test(f)).sort())
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return ctx.window.TAMIL;
}
