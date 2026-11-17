/* Tamil memory trainer: hooks + memory palaces + spaced review. No build step. */
(function () {
  'use strict';
  const DATA = window.TAMIL;
  const ITEMS = DATA.items;
  const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  const KEY = 'tamil-mem-v1';
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const LEARN_STEPS = [1 * MIN, 10 * MIN, 5 * HOUR]; // last step lands in the next bus ride
  const FADE_DAYS = 21, LEECH_LAPSES = 3, LEARN_AHEAD = 20 * MIN;

  // ---------- storage ----------
  const fresh = () => ({ v: 1, items: {}, cards: {}, days: {}, spots: {}, settings: { newPerDay: 15, typing: false, theme: 'auto' } });
  let S = fresh();
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) { /* private mode etc. */ }
  S.settings = Object.assign(fresh().settings, S.settings);
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* keep in memory */ } }

  const now = () => Date.now();
  const dayKey = (t = now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const today = () => (S.days[dayKey()] = S.days[dayKey()] || { new: 0, reviews: 0 });
  const isEvening = () => new Date().getHours() >= 15;

  // ---------- cards ----------
  function cardsFor(item) {
    if (item.kind === 'word') return [{ cid: item.id + ':p', dir: 'p' }, { cid: item.id + ':r', dir: 'r' }];
    if (item.kind === 'phrase') return [{ cid: item.id + ':p', dir: 'p' }];
    return (item.drills || []).map((d, i) => ({ cid: item.id + ':d' + i, dir: 'd', drill: i }));
  }
  function parseCid(cid) {
    const [id, k] = cid.split(':');
    return { item: BY_ID[id], dir: k[0], drill: k[0] === 'd' ? +k.slice(1) : null };
  }
  const introduced = id => !!(S.items[id] && S.items[id].at);

  function introduce(item) {
    S.items[item.id] = Object.assign(S.items[item.id] || {}, { at: now() });
    cardsFor(item).forEach((c, i) => {
      // Production first now; recognition waits for the next session.
      const later = c.dir === 'r';
      S.cards[c.cid] = { due: now() + (later ? LEARN_STEPS[2] : i * 1000), step: later ? 2 : 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0, learning: true };
    });
    today().new++;
    save();
  }

  function nextNew() {
    for (const it of ITEMS) {
      if (introduced(it.id)) continue;
      if (it.kind === 'phrase' && !(it.buildsOn || []).every(introduced)) continue;
      return it;
    }
    return null;
  }
  const newLeft = () => Math.max(0, S.settings.newPerDay - today().new);
  function dueCards(ahead = 0) {
    const t = now() + ahead;
    return Object.entries(S.cards).filter(([cid, c]) => c.due <= t && BY_ID[cid.split(':')[0]])
      .sort((a, b) => a[1].due - b[1].due).map(([cid]) => cid);
  }

  const dayStart = t => { const d = new Date(t); d.setHours(3, 0, 0, 0); return d.getTime(); };
  function preview(c, g) { return schedule(Object.assign({}, c), g, true); }
  function schedule(c, g, dry) { // g: 0 again, 1 hard, 2 good, 3 easy
    const t = now();
    if (c.learning) {
      if (g === 0) { c.step = 0; c.due = t + LEARN_STEPS[0]; }
      else if (g === 1) { c.due = t + LEARN_STEPS[c.step]; }
      else if (g === 3 || c.step >= LEARN_STEPS.length - 1) {
        c.learning = false; c.ivl = g === 3 ? 3 : 1; c.due = dayStart(t + c.ivl * DAY);
      } else { c.step++; c.due = t + LEARN_STEPS[c.step]; }
    } else if (c.relearn) {
      if (g === 0) c.due = t + 10 * MIN;
      else { c.relearn = false; c.due = dayStart(t + c.ivl * DAY); }
    } else {
      if (g === 0) {
        c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.ivl = Math.max(1, Math.round(c.ivl * 0.4));
        c.relearn = true; c.due = t + 10 * MIN;
      } else {
        if (g === 1) { c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); }
        if (g === 2) c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * c.ease));
        if (g === 3) { c.ivl = Math.max(c.ivl + 2, Math.round(c.ivl * c.ease * 1.3)); c.ease += 0.15; }
        if (!dry) c.ivl = Math.round(c.ivl * (0.95 + Math.random() * 0.1)) || 1; // light fuzz
        c.due = dayStart(t + c.ivl * DAY);
      }
    }
    if (!dry) c.reps++;
    return c;
  }
  function fmtGap(c) {
    const ms = c.due - now();
    if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + 'm';
    if (ms < DAY) return Math.round(ms / HOUR) + 'h';
    return Math.max(1, Math.round(ms / DAY)) + 'd';
  }

  // ---------- item status ----------
  function lapses(id) { return Object.entries(S.cards).filter(([k]) => k.split(':')[0] === id).reduce((n, [, c]) => n + c.lapses, 0); }
  function prodIvl(item) { const c = S.cards[item.id + ':p'] || S.cards[item.id + ':d0']; return c ? c.ivl : 0; }
  const faded = item => !(S.items[item.id] || {}).unfade && prodIvl(item) >= FADE_DAYS;
  const isLeech = item => lapses(item.id) >= LEECH_LAPSES;
  function stage(item) {
    if (!introduced(item.id)) return { label: 'new', cls: '' };
    if (isLeech(item)) return { label: 'rebuild hook', cls: 'warn' };
    if (faded(item)) return { label: 'fluent', cls: 'ok' };
    const c = S.cards[item.id + ':p'] || S.cards[item.id + ':d0'];
    return c && c.learning ? { label: 'learning', cls: '' } : { label: 'hooked', cls: 'ok' };
  }
  function hookText(item) {
    const st = S.items[item.id] || {};
    if (st.custom) return st.custom;
    if (item.kind === 'pattern') return item.hook;
    return (item.hooks || [])[st.hook || 0] || '';
  }

  // ---------- helpers ----------
  const $view = document.getElementById('view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const imgTag = (item, cls = '') => item.img ? `<img class="sketch ${cls}" src="img/${esc(item.id)}.webp" alt="Sketch: ${esc(item.img)}" loading="lazy" onerror="this.remove()">` : '';
  const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1').replace(/th/g, 't').replace(/dh/g, 'd').replace(/y(?=e)/g, '');
  function render(html) { $view.innerHTML = html; $view.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  function setTop() {
    const d = dueCards().length;
    document.getElementById('top-status').textContent = d ? d + ' due' : '';
  }
  function patternTable(p) {
    const [head, ...rows] = p.table;
    return `<div class="table-wrap"><table class="pat"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function buildsOnBadges(item) {
    return (item.buildsOn || []).map(id => {
      const b = BY_ID[id]; if (!b) return '';
      const label = b.kind === 'pattern' ? b.title : `${b.tamil} = ${b.en}`;
      return `<span class="badge ${introduced(id) ? 'ok' : ''}">builds on: ${esc(label)}</span>`;
    }).join('');
  }
  function hookPicker(item) {
    const st = S.items[item.id] || {};
    const opts = (item.hooks || []).map((h, i) => `
      <label class="hook-opt ${!st.custom && (st.hook || 0) === i ? 'on' : ''}">
        <input type="radio" name="hook" value="${i}" ${!st.custom && (st.hook || 0) === i ? 'checked' : ''}>
        <span>${esc(h)}</span></label>`).join('');
    return `${opts}
      <label class="hook-opt ${st.custom ? 'on' : ''}"><input type="radio" name="hook" value="custom" ${st.custom ? 'checked' : ''}>
        <span style="flex:1">My own hook (cover every syllable, first sound most vivid)<br>
        <textarea id="custom-hook" placeholder="Picture…">${esc(st.custom || '')}</textarea></span></label>`;
  }
  function readHookPicker(item) {
    const sel = $view.querySelector('input[name=hook]:checked');
    if (!sel) return;
    const st = S.items[item.id] = S.items[item.id] || {};
    const txt = ($view.querySelector('#custom-hook') || {}).value || '';
    if (sel.value === 'custom' && txt.trim()) { st.custom = txt.trim(); }
    else { delete st.custom; st.hook = sel.value === 'custom' ? 0 : +sel.value; }
    save();
  }
  function wireHookPicker() {
    $view.querySelectorAll('.hook-opt').forEach(l => l.addEventListener('change', () => {
      $view.querySelectorAll('.hook-opt').forEach(x => x.classList.toggle('on', x.querySelector('input').checked));
    }));
    const ta = $view.querySelector('#custom-hook');
    if (ta) ta.addEventListener('input', () => { const r = ta.closest('.hook-opt').querySelector('input'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  // ---------- views ----------
  function viewToday() {
    const due = dueCards().length, nn = nextNew() ? newLeft() : 0;
    const learned = ITEMS.filter(i => introduced(i.id)).length;
    const leeches = ITEMS.filter(i => introduced(i.id) && isLeech(i)).length;
    const evening = isEvening();
    const t = today();
    render(`
      <h1>${evening ? 'Evening ride' : 'Morning ride'}</h1>
      <p class="muted">${evening ? 'Reviews only: a second pass over this morning’s words.' : 'Reviews first, then new words with hooks.'}</p>
      <div class="stats">
        <div class="stat"><b>${due}</b><span>due now</span></div>
        <div class="stat"><b>${nn}</b><span>new left today</span></div>
        <div class="stat"><b>${learned}/${ITEMS.length}</b><span>items started</span></div>
      </div>
      ${due || (!evening && nn) ? `<a class="btn primary block" href="#study">Start (${due} review${due === 1 ? '' : 's'}${!evening && nn ? ` + ${nn} new` : ''})</a>` :
        `<div class="card center"><p><b>All done for now.</b></p><p class="muted small">${nextDueText()}</p></div>`}
      ${evening && nn ? `<a class="btn block" href="#study-new">Learn new words anyway (${nn})</a>` : ''}
      ${leeches ? `<a class="btn block" href="#words/weak">⚠ ${leeches} word${leeches > 1 ? 's' : ''} need a new hook</a>` : ''}
      <div class="card small">
        <b>How it works</b>
        <p>1. <b>Hook:</b> each new word gets a vivid sound-image. Pick one or write your own; your own sticks best.</p>
        <p>2. <b>Recall:</b> see the English, say the Tamil in your head (mouthing counts), then check.</p>
        <p>3. <b>Fade:</b> once a word holds for ${FADE_DAYS}+ days the hook hides; you just know it.</p>
        <p class="muted">Today: ${t.new} new, ${t.reviews} reviews.</p>
      </div>`);
  }
  function nextDueText() {
    const ds = Object.values(S.cards).map(c => c.due).filter(d => d > now()).sort((a, b) => a - b);
    if (!ds.length) return nextNew() ? 'New words unlock tomorrow.' : 'Lesson complete. More lessons coming.';
    const ms = ds[0] - now();
    return 'Next review in ' + (ms < HOUR ? Math.ceil(ms / MIN) + ' min' : ms < DAY ? Math.round(ms / HOUR) + ' h' : Math.round(ms / DAY) + ' days') + '.';
  }

  // --- study session ---
  let session = null;
  function startStudy(newOnly) {
    session = { newOnly, done: 0, allowNew: newOnly || !isEvening() };
    stepStudy();
  }
  function stepStudy() {
    setTop();
    let due = session.newOnly ? [] : dueCards();
    if (!due.length && !session.newOnly) {
      // learning cards coming up within a few minutes: show them now rather than stall
      const ahead = dueCards(LEARN_AHEAD).filter(cid => S.cards[cid].learning || S.cards[cid].relearn);
      if (ahead.length && !(session.allowNew && newLeft() && nextNew())) due = ahead;
    }
    if (due.length) return showCard(due[0]);
    if (session.allowNew && newLeft() > 0) {
      const it = nextNew();
      if (it) return showLearn(it);
    }
    const ahead = dueCards(LEARN_AHEAD);
    if (ahead.length) return showCard(ahead[0]);
    render(`<h1>Session done</h1><p>${session.done} cards reviewed.</p>
      <p class="muted">${nextDueText()}</p><a class="btn primary block" href="#today">Back to Today</a>`);
    session = null;
  }

  function showLearn(item) {
    const kindLabel = { word: 'New word', pattern: 'New pattern', phrase: 'New phrase' }[item.kind];
    let body = '';
    if (item.kind === 'word') {
      body = `<div class="big">${esc(item.tamil)}</div><div class="answer" style="color:var(--text)">${esc(item.en)}</div>
        ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
        ${imgTag(item)}
        <p class="pron">${esc(item.pron || '')}</p>
        ${buildsOnBadges(item)}
        ${item.set ? palaceSpotLine(item) : ''}
        <h2>Pick your hook</h2>${hookPicker(item)}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
        <p class="muted small">Close your eyes for 5 seconds and really see the scene: sound, colour, movement.</p>`;
    } else if (item.kind === 'pattern') {
      body = `<div class="big">${esc(item.title)}</div><p>${esc(item.rule)}</p>
        <div class="hook">${esc(item.hook)}</div>${patternTable(item)}
        <p class="muted small">You’ll now drill ${item.drills.length} quick forms. Build each from the rule; don’t memorise them one by one.</p>`;
    } else {
      body = `<div class="big">${esc(item.en)}</div><div class="answer">${esc(item.tamil)}</div>
        ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
        <h2>Built from</h2><div>${(item.buildsOn || []).map(id => BY_ID[id]).filter(Boolean).map(b =>
          `<span class="badge ok">${esc(b.kind === 'pattern' ? b.title : b.tamil + ' = ' + b.en)}</span>`).join('')}</div>
        <p class="muted small">Say the whole phrase out loud (or mouth it) twice.</p>`;
    }
    render(`<div class="prompt-label">${kindLabel} · ${today().new + 1} of ${S.settings.newPerDay} today</div>
      <div class="card">${body}</div>
      <button class="btn primary block" id="go">Got it, test me</button>
      <button class="btn link" id="skip">I already know this</button>`);
    if (item.kind === 'word') wireHookPicker();
    document.getElementById('go').onclick = () => { if (item.kind === 'word') readHookPicker(item); introduce(item); stepStudy(); };
    document.getElementById('skip').onclick = () => {
      introduce(item);
      cardsFor(item).forEach(c => Object.assign(S.cards[c.cid], { learning: false, ivl: 7, due: dayStart(now() + 7 * DAY) }));
      save(); stepStudy();
    };
  }

  function palaceSpotLine(item) {
    const p = DATA.palaces.find(x => x.id === item.set); if (!p) return '';
    const spot = (S.spots[p.id] || [])[item.spot] || p.spots[item.spot];
    return `<div class="note">🏛 Memory palace: <b>${esc(p.title)}</b>, spot ${item.spot + 1}: <b>${esc(spot)}</b>. Put the scene there.</div>`;
  }

  function cardPrompt(cid) {
    const { item, dir, drill } = parseCid(cid);
    if (dir === 'd') { const [q, a] = item.drills[drill]; return { label: item.title, q, a, alts: [] }; }
    if (dir === 'r') return { label: 'What does this mean?', q: item.tamil, a: item.en, alts: [] };
    return { label: item.kind === 'phrase' ? 'Say it in Tamil' : 'Tamil for…', q: item.en, a: item.tamil, alts: item.variants || [] };
  }

  function showCard(cid) {
    const { item, dir } = parseCid(cid);
    const c = S.cards[cid];
    const p = cardPrompt(cid);
    const typing = S.settings.typing && dir !== 'r';
    render(`<div class="prompt-label">${esc(p.label)}${c.learning ? ' · learning' : c.relearn ? ' · relearning' : ''}</div>
      <div class="card"><div class="big">${esc(p.q)}</div>
        ${typing ? `<div class="typed"><input type="text" id="typed" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the Tamil (romanised)"></div>` : ''}
        <div id="reveal"></div></div>
      <button class="btn primary block" id="show">Show answer</button>
      <div id="grades"></div>`);
    const typed = document.getElementById('typed');
    if (typed) { typed.focus(); typed.addEventListener('keydown', e => { if (e.key === 'Enter') reveal(); }); }
    document.getElementById('show').onclick = reveal;

    function reveal() {
      const t = typed ? typed.value.trim() : '';
      let check = '';
      if (t) {
        const ok = [p.a, ...p.alts].some(a => norm(a) === norm(t));
        check = `<div class="check">${ok ? '✓ matches' : '≠ you typed “' + esc(t) + '”: compare carefully'}</div>`;
      }
      const showHook = dir !== 'd' && item.kind === 'word';
      const hide = faded(item);
      document.getElementById('reveal').innerHTML = `<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
        <div class="answer">${esc(p.a)}</div>${p.alts.length ? `<div class="muted small">also: ${p.alts.map(esc).join(', ')}</div>` : ''}${check}
        ${showHook ? (hide ? `<button class="btn link" id="peek">Show hook (faded: you know this one)</button><div id="hookbox" hidden>` : '<div>') +
          `<div class="hook">${esc(hookText(item))}</div>${item.pron ? `<p class="pron">${esc(item.pron)}</p>` : ''}</div>` : ''}
        ${item.kind === 'phrase' ? `<div>${(item.buildsOn || []).map(id => BY_ID[id]).filter(b => b && b.kind === 'word').map(b => `<span class="badge">${esc(b.tamil)} = ${esc(b.en)}</span>`).join('')}</div>` : ''}`;
      const peek = document.getElementById('peek');
      if (peek) peek.onclick = () => { document.getElementById('hookbox').hidden = false; peek.remove(); };
      document.getElementById('show').remove();
      const labels = ['Again', 'Hard', 'Good', 'Easy'], cls = ['g-again', 'g-hard', 'g-good', 'g-easy'];
      document.getElementById('grades').innerHTML = `<div class="grades">${labels.map((l, g) =>
        `<button class="btn ${cls[g]}" data-g="${g}">${l}<small>${fmtGap(preview(c, g))}</small></button>`).join('')}</div>`;
      document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => grade(+b.dataset.g));
    }
    function grade(g) {
      schedule(c, g); today().reviews++; session.done++; save();
      if (g === 0 && item.kind !== 'phrase') return showMiss(item, cid);
      stepStudy();
    }
  }

  function showMiss(item, cid) {
    const leech = isLeech(item);
    if (item.kind === 'pattern') {
      render(`<div class="prompt-label">Missed: rebuild it from the rule</div>
        <div class="card"><div class="big">${esc(item.title)}</div><div class="hook">${esc(item.hook)}</div>${patternTable(item)}</div>
        <button class="btn primary block" id="next">Continue</button>`);
    } else {
      render(`<div class="prompt-label">Missed: re-see the scene</div>
        <div class="card"><div class="big">${esc(item.tamil)}</div><div class="answer" style="color:var(--text)">${esc(item.en)}</div>
        ${imgTag(item)}
        ${leech ? `<div class="leech"><b>This hook isn’t working</b> (missed ${lapses(item.id)} times). A failing hook means a weak image, not a weak memory. Pick another or make it stranger, louder, funnier.</div>
          ${hookPicker(item)}` : `<div class="hook">${esc(hookText(item))}</div>`}
        <p class="pron">${esc(item.pron || '')}</p>
        ${item.set ? palaceSpotLine(item) : ''}</div>
        <button class="btn primary block" id="next">${leech ? 'Save hook & continue' : 'Continue'}</button>`);
      if (leech) wireHookPicker();
    }
    document.getElementById('next').onclick = () => { if (leech && item.kind === 'word') readHookPicker(item); stepStudy(); };
  }

  // --- words ---
  function viewWords(filter) {
    filter = filter || 'all';
    const words = ITEMS.filter(i => i.kind === 'word');
    const phrases = ITEMS.filter(i => i.kind === 'phrase');
    const pick = { all: words, weak: words.filter(i => introduced(i.id) && (isLeech(i) || lapses(i.id) > 0)).sort((a, b) => lapses(b.id) - lapses(a.id)), phrases }[filter] || words;
    render(`<h1>Words</h1>
      <div class="filters">${[['all', 'All words'], ['weak', 'Weak spots'], ['phrases', 'Phrases']].map(([k, l]) =>
        `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${filter === 'weak' ? '<p class="muted small">Words you have missed, worst first. Tap one to rebuild its hook.</p>' : ''}
      ${pick.length ? `<ul class="list">${pick.map(i => {
        const s = stage(i);
        return `<li><a href="#item/${esc(i.id)}"><span><b>${esc(i.tamil)}</b> <span class="badge ${s.cls}">${s.label}</span>${filter === 'weak' ? ` <span class="badge warn">${lapses(i.id)} misses</span>` : ''}</span><span class="en">${esc(i.en)}</span></a></li>`;
      }).join('')}</ul>` : '<p class="muted">Nothing here yet.</p>'}`);
    $view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = b.dataset.f === 'all' ? '#words' : '#words/' + b.dataset.f; });
  }

  function viewItem(id) {
    const item = BY_ID[id];
    if (!item) return viewWords();
    const cards = cardsFor(item).map(c => [c, S.cards[c.cid]]).filter(([, s]) => s);
    const s = stage(item);
    const stats = cards.length ? cards.map(([c, st]) =>
      `<span class="badge">${c.dir === 'p' ? 'EN→TA' : c.dir === 'r' ? 'TA→EN' : 'drill'}: ${st.learning ? 'learning' : 'every ' + st.ivl + 'd'}, ${st.lapses} miss</span>`).join('') : '<span class="badge">not started</span>';
    if (item.kind === 'phrase') {
      render(`<a href="#words/phrases" class="btn link">‹ Phrases</a><div class="card"><div class="big">${esc(item.en)}</div><div class="answer">${esc(item.tamil)}</div>
        ${buildsOnBadges(item)}<p>${stats}</p></div>`);
      return;
    }
    render(`<a href="#words" class="btn link">‹ Words</a>
      <div class="card"><div class="big">${esc(item.tamil)}</div><div class="answer" style="color:var(--text)">${esc(item.en)}</div>
      ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
      <p><span class="badge ${s.cls}">${s.label}</span>${stats}</p>
      ${imgTag(item)}<p class="pron">${esc(item.pron || '')}</p>${buildsOnBadges(item)}
      ${item.set ? palaceSpotLine(item) : ''}
      ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      <h2>Hook</h2>${hookPicker(item)}
      <button class="btn primary block" id="save">Save hook</button>
      ${faded(item) ? '<button class="btn block" id="unfade">Bring the hook back during reviews</button>' : ''}
      </div>`);
    wireHookPicker();
    document.getElementById('save').onclick = () => { readHookPicker(item); toast('Hook saved'); };
    const uf = document.getElementById('unfade');
    if (uf) uf.onclick = () => { (S.items[id] = S.items[id] || {}).unfade = true; save(); viewItem(id); };
  }

  // --- patterns ---
  function viewPatterns() {
    const pats = ITEMS.filter(i => i.kind === 'pattern');
    render(`<h1>Patterns</h1><p class="muted">Learn the rule once, then build the forms. This is chunking: one rule unlocks many words.</p>
      ${pats.map(p => `<div class="card"><h2 style="margin-top:0">${esc(p.title)} ${introduced(p.id) ? '' : '<span class="badge">not yet</span>'}</h2>
        <p>${esc(p.rule)}</p><div class="hook">${esc(p.hook)}</div>${patternTable(p)}</div>`).join('')}`);
  }

  // --- palaces ---
  function viewPalaces(id, walk) {
    if (id) return viewPalace(id, walk);
    render(`<h1>Memory palaces</h1><p class="muted">For sets of words, put each word at a spot in a place you know well and walk through it in your head. Rename the spots to your real ones; your own places work far better than invented ones.</p>
      ${DATA.palaces.map(p => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#palace/${esc(p.id)}">
        <b>${esc(p.title)}</b><br><span class="muted small">${p.spots.length} spots · Lesson ${p.lesson}</span></a>`).join('')}`);
  }
  function palaceWords(p) { return ITEMS.filter(i => i.set === p.id).sort((a, b) => a.spot - b.spot); }
  function viewPalace(id, walk) {
    const p = DATA.palaces.find(x => x.id === id); if (!p) return viewPalaces();
    const names = p.spots.map((s, i) => (S.spots[p.id] || [])[i] || s);
    const words = palaceWords(p);
    if (walk != null) {
      const i = +walk, w = words[i];
      if (!w) { render(`<h1>Walk complete</h1><a class="btn primary block" href="#palace/${esc(id)}">Back</a>`); return; }
      render(`<a href="#palace/${esc(id)}" class="btn link">‹ ${esc(p.title)}</a>
        <div class="progress"><div style="width:${(i / words.length) * 100}%"></div></div>
        <div class="card center"><div class="prompt-label">Spot ${i + 1}</div><div class="big">${esc(names[w.spot])}</div>
        <p class="muted">What’s happening here? Say the Tamil word.</p><div id="rv"></div>
        <button class="btn primary block" id="rvb">Reveal</button></div>`);
      document.getElementById('rvb').onclick = function () {
        document.getElementById('rv').innerHTML = `<div class="answer">${esc(w.tamil)}</div><div>${esc(w.en)}</div>${imgTag(w, 'small')}<div class="hook" style="text-align:left">${esc(hookText(w))}</div>`;
        this.textContent = 'Next spot'; this.onclick = () => { location.hash = `#palace/${id}/${i + 1}`; };
      };
      return;
    }
    render(`<a href="#palaces" class="btn link">‹ Palaces</a><h1>${esc(p.title)}</h1><p>${esc(p.intro)}</p>
      <div class="card">${words.map(w => `<div class="spot"><span class="num">${w.spot + 1}</span>
        <div><input type="text" data-spot="${w.spot}" value="${esc(names[w.spot])}" aria-label="Spot ${w.spot + 1} name">
        <div class="small" style="margin-top:4px">${introduced(w.id) ? `<b>${esc(w.tamil)}</b> = ${esc(w.en)}` : '<span class="muted">(not learned yet)</span>'}</div></div></div>`).join('')}</div>
      <a class="btn primary block" href="#palace/${esc(id)}/0">Walk through it</a>`);
    $view.querySelectorAll('[data-spot]').forEach(inp => inp.addEventListener('change', () => {
      const arr = S.spots[p.id] = S.spots[p.id] || [];
      arr[+inp.dataset.spot] = inp.value.trim() || p.spots[+inp.dataset.spot]; save(); toast('Spot renamed');
    }));
  }

  // --- settings ---
  function viewSettings() {
    const st = S.settings;
    render(`<h1>Settings</h1>
      <div class="card">
        <label>New items per day<br><input type="number" id="npd" min="1" max="60" value="${st.newPerDay}"></label>
        <p class="muted small">About 15 suits two 20–30 minute bus rides.</p>
        <label class="row" style="margin-top:12px"><input type="checkbox" id="typing" ${st.typing ? 'checked' : ''}> Type answers (optional, otherwise just say them in your head)</label>
        <p style="margin-top:12px">Theme</p>
        <div class="filters">${['auto', 'light', 'dark'].map(t => `<button data-theme-btn="${t}" class="${st.theme === t ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div>
      <div class="card">
        <b>Backup</b>
        <p class="muted small">Progress lives only in this browser. Export a backup now and then; clearing browser data would wipe it.</p>
        <button class="btn block" id="exp">Export backup</button>
        <label class="btn block" for="imp">Import backup</label><input type="file" id="imp" accept="application/json,.json" hidden>
      </div>
      <div class="card"><button class="btn block g-again" id="reset">Reset all progress</button></div>
      <p class="muted small center">Methods from <i>Moonwalking with Einstein</i>: elaborative encoding, memory palaces, chunking, plus spaced retrieval.</p>`);
    document.getElementById('npd').onchange = e => { st.newPerDay = Math.max(1, Math.min(60, +e.target.value || 15)); save(); };
    document.getElementById('typing').onchange = e => { st.typing = e.target.checked; save(); };
    $view.querySelectorAll('[data-theme-btn]').forEach(b => b.onclick = () => { st.theme = b.dataset.themeBtn; save(); applyTheme(); viewSettings(); });
    document.getElementById('exp').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tamil-backup-${dayKey()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    document.getElementById('imp').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj || typeof obj.cards !== 'object') throw new Error('not a backup');
        S = Object.assign(fresh(), obj); S.settings = Object.assign(fresh().settings, S.settings); save(); applyTheme(); toast('Backup restored'); viewSettings();
      } catch (err) { toast('That file is not a valid backup'); }
    };
    document.getElementById('reset').onclick = () => {
      if (confirm('Delete all progress and custom hooks on this device?')) { S = fresh(); save(); applyTheme(); toast('Progress reset'); viewSettings(); }
    };
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:10px;z-index:9;font-size:15px';
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  }
  function applyTheme() {
    const th = S.settings.theme;
    if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  }

  // ---------- router ----------
  function route() {
    const h = location.hash.replace(/^#/, '') || 'today';
    const [name, a, b] = h.split('/');
    const tab = { study: 'today', 'study-new': 'today', item: 'words', palace: 'palaces' }[name] || name;
    document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    setTop();
    if (name === 'study') return startStudy(false);
    if (name === 'study-new') return startStudy(true);
    if (name === 'words') return viewWords(a);
    if (name === 'item') return viewItem(a);
    if (name === 'patterns') return viewPatterns();
    if (name === 'palaces') return viewPalaces();
    if (name === 'palace') return viewPalaces(a, b);
    if (name === 'settings') return viewSettings();
    return viewToday();
  }
  window.addEventListener('hashchange', route);
  applyTheme();
  route();

  // ---------- offline ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'warm', urls: ITEMS.filter(i => i.img).map(i => `img/${i.id}.webp`) });
    }).catch(() => {});
  }
  window.__tamil = { S: () => S, schedule, dueCards }; // for tests
})();
