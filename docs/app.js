/* Tamil memory trainer: hooks + memory palaces + spaced review. No build step. */
(function () {
  'use strict';
  const DATA = window.TAMIL;
  const ITEMS = DATA.items;
  const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  const CATS = DATA.cats || {};
  const KEY = 'tamil-mem-v1';
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const LEARN_STEPS = [1 * MIN, 10 * MIN, 5 * HOUR]; // the last step lands in the next bus ride
  const FADE_DAYS = 7;          // hooks hide once a word holds for a week
  const LEECH = 3;              // misses (since the hook last changed) before a hook is flagged
  const LEARN_AHEAD = 20 * MIN; // learning cards due soon may be pulled forward at the end of a ride
  const SEC_REVIEW = 10, SEC_NEW = 60; // rough seconds per card, for the ride budget
  const GAP_NEW = 2, GAP_AFTER = 3, GAP_MISS = 4; // other screens between repeats of the same card

  // ---------- storage ----------
  const fresh = () => ({ v: 2, items: {}, cards: {}, days: {}, spots: {}, lastExport: 0,
    settings: { newPerDay: 15, rideMin: 25, typing: false, theme: 'auto', script: false, autoplay: true } });
  let S = fresh();
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) { /* private mode etc. */ }
  S.settings = Object.assign(fresh().settings, S.settings);
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* keep in memory */ } }

  const now = () => Date.now();
  const dayKey = (t = now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const today = () => (S.days[dayKey()] = Object.assign({ new: 0, reviews: 0, sincePhrase: 0 }, S.days[dayKey()]));
  const isEvening = () => new Date().getHours() >= 15;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  // ---------- cards ----------
  const introduced = id => !!(S.items[id] && S.items[id].at);
  const itemState = id => (S.items[id] = S.items[id] || {});
  function graduated(id) {
    const it = BY_ID[id]; if (!it) return false;
    if (it.kind === 'pattern') return introduced(id);
    const c = S.cards[id + ':p'];
    return !!(c && !c.learning);
  }
  function parseCid(cid) {
    const [id, k] = cid.split(':');
    return { item: BY_ID[id], dir: k[0], drill: k[0] === 'd' ? +k.slice(1) : null };
  }
  const newCard = (due, step) => ({ due, step, ivl: 0, ease: 2.5, reps: 0, lapses: 0, learning: true });

  function introduce(item) {
    const st = itemState(item.id); st.at = now(); st.misses = 0;
    const t = today();
    if (item.kind === 'word' || item.kind === 'phrase') {
      S.cards[item.id + ':p'] = newCard(now(), 0);
      if (session) session.nb[item.id + ':p'] = session.count + GAP_NEW; // one other screen before the first test
      if (item.kind === 'word') S.cards[item.id + ':r'] = newCard(now() + LEARN_STEPS[2], 2); // recognition waits for the next ride
    }
    t.new++;
    t.sincePhrase = item.kind === 'phrase' ? 0 : (t.sincePhrase || 0) + 1;
    syncDrills();
    save();
  }
  // Pattern drills only appear once the words they use have been learned.
  function syncDrills() {
    let k = 0;
    for (const p of ITEMS) {
      if (p.kind !== 'pattern' || !introduced(p.id)) continue;
      (p.drills || []).forEach((d, i) => {
        const cid = p.id + ':d' + i;
        if (S.cards[cid] || !(d[2] || []).every(introduced)) return;
        S.cards[cid] = newCard(now(), 0);
        if (session) session.nb[cid] = session.count + GAP_NEW + (k++);
      });
    }
  }
  function nextNew() {
    let word = null, phrase = null;
    for (const it of ITEMS) {
      if (introduced(it.id)) continue;
      if (it.kind === 'phrase') {
        if (!phrase && (it.buildsOn || []).every(graduated)) phrase = it;
      } else if (!word && (!it.holdUntil || graduated(it.holdUntil))) word = it;
      if (word && phrase) break;
    }
    if (phrase && ((today().sincePhrase || 0) >= 2 || !word)) return phrase;
    return word || phrase;
  }
  const newLeft = () => Math.max(0, S.settings.newPerDay - today().new);
  function dueCards(ahead = 0) {
    const t = now() + ahead;
    return Object.entries(S.cards).filter(([cid, c]) => c.due <= t && BY_ID[cid.split(':')[0]])
      .sort((a, b) => a[1].due - b[1].due).map(([cid]) => cid);
  }

  const dayStart = t => { const d = new Date(t); d.setHours(3, 0, 0, 0); return d.getTime(); };
  const preview = (c, g) => schedule(Object.assign({}, c), g, true);
  function schedule(c, g, dry) { // g: 0 again, 1 hard, 2 good, 3 easy (easy only after learning)
    const t = now();
    if (c.learning) {
      if (g === 0) { c.step = 0; c.due = t + LEARN_STEPS[0]; }
      else if (g === 1) { c.due = t + LEARN_STEPS[c.step]; }
      else if (c.step >= LEARN_STEPS.length - 1) { c.learning = false; c.ivl = 1; c.due = dayStart(t + DAY); }
      else { c.step++; c.due = t + LEARN_STEPS[c.step]; }
    } else if (c.relearn) {
      if (g === 0) c.due = t + 10 * MIN;
      else { c.relearn = false; c.due = dayStart(t + c.ivl * DAY); }
    } else if (g === 0) {
      c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.ivl = Math.max(1, Math.round(c.ivl * 0.4));
      c.relearn = true; c.due = t + 10 * MIN;
    } else {
      if (g === 1) { c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.1); }
      if (g === 2) c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * c.ease));
      if (g === 3) { c.ivl = Math.max(c.ivl + 2, Math.round(c.ivl * c.ease * 1.3)); c.ease += 0.15; }
      if (!dry) c.ivl = Math.round(c.ivl * (0.95 + Math.random() * 0.1)) || 1; // light fuzz
      c.due = dayStart(t + c.ivl * DAY);
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
  const misses = id => (S.items[id] || {}).misses || 0;
  const isLeech = item => item.kind === 'word' && introduced(item.id) && misses(item.id) >= LEECH;
  const leeches = () => ITEMS.filter(isLeech);
  function prodIvl(item) { const c = S.cards[item.id + ':p']; return c ? c.ivl : 0; }
  const faded = item => !(S.items[item.id] || {}).unfade && prodIvl(item) >= FADE_DAYS;
  function stage(item) {
    if (!introduced(item.id)) return { label: 'new', cls: '' };
    if (isLeech(item)) return { label: 'fix hook', cls: 'warn' };
    if (faded(item)) return { label: 'fluent', cls: 'ok' };
    const c = S.cards[item.id + ':p'];
    return c && c.learning ? { label: 'learning', cls: '' } : { label: 'hooked', cls: 'ok' };
  }
  // hook choice: 0 = primary (sound/meaning/see), n = alts[n-1], or a custom text
  const hookChoice = item => { const st = S.items[item.id] || {}; return st.custom ? 'custom' : (st.hook || 0); };

  // ---------- speech ----------
  let taVoice = null;
  function loadVoices() {
    try { taVoice = (window.speechSynthesis.getVoices() || []).find(v => /^ta/i.test(v.lang)) || null; } catch (e) { taVoice = null; }
  }
  if ('speechSynthesis' in window) { loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }
  function speak(text) {
    if (!taVoice || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text); u.voice = taVoice; u.lang = taVoice.lang; u.rate = 0.8;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  const $view = document.getElementById('view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = s => String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1').replace(/th/g, 't').replace(/dh/g, 'd').replace(/y(?=e)/g, '');
  function render(html) { $view.innerHTML = html; $view.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  const speakBtn = ta => taVoice && ta ? ` <button class="speak" data-say="${esc(ta)}" aria-label="Hear it">🔊</button>` : '';
  const scriptLine = ta => S.settings.script && ta ? `<div class="script" lang="ta">${esc(ta)}</div>` : '';
  const catBadge = item => item.cat ? `<span class="badge cat-b cat-${item.cat}">${esc(CATS[item.cat] || item.cat)}</span>` : '';
  function picture(item, opts = {}) {
    if (item.noImg) return '';
    const note = opts.noNote || !item.picNote ? '' : `<figcaption class="pic-note">${esc(item.picNote)}</figcaption>`;
    return `<figure class="pic"><img class="sketch ${opts.small ? 'small' : ''}" src="img/${esc(item.id)}.webp" alt="${esc(item.see)}" loading="lazy" onerror="this.parentNode.remove()">${note}</figure>`;
  }
  function hookBlock(item) {
    if (item.kind === 'pattern') return `<div class="hook">${esc(item.hook)}</div>`;
    const ch = hookChoice(item);
    if (ch === 'custom') return `<div class="hook"><b>Your hook:</b> ${esc(S.items[item.id].custom)}</div>`;
    if (ch > 0 && item.alts[ch - 1]) return `<div class="hook">${esc(item.alts[ch - 1])}</div>`;
    return `<dl class="why"><dt>Sound</dt><dd>${esc(item.sound)}</dd><dt>Meaning</dt><dd>${esc(item.meaning)}</dd><dt>See it</dt><dd>${esc(item.see)}</dd></dl>`;
  }
  function setTop(text) {
    const el = document.getElementById('top-status');
    if (text != null) { el.textContent = text; return; }
    const d = dueCards().length;
    el.textContent = d ? plural(d, 'card') + ' due' : '';
  }
  function patternTable(p) {
    const [head, ...rows] = p.table;
    return `<div class="table-wrap"><table class="pat"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function chips(item) {
    return (item.buildsOn || []).map(id => BY_ID[id]).filter(Boolean).map(b =>
      `<span class="badge ${introduced(b.id) ? 'ok' : ''}">${esc(b.kind === 'pattern' ? b.title : b.tamil + ' = ' + b.en)}</span>`).join('');
  }
  function hookPicker(item, preselect) {
    const st = S.items[item.id] || {};
    const cur = preselect != null ? preselect : hookChoice(item);
    const opts = [{ v: 0, html: `<b>Sound</b> ${esc(item.sound)} · <b>Meaning</b> ${esc(item.meaning)} · <b>See it</b> ${esc(item.see)}` }]
      .concat(item.alts.map((a, i) => ({ v: i + 1, html: esc(a) })));
    return opts.map(o => `<label class="hook-opt ${cur === o.v ? 'on' : ''}"><input type="radio" name="hook" value="${o.v}" ${cur === o.v ? 'checked' : ''}><span>${o.html}</span></label>`).join('') +
      `<label class="hook-opt ${cur === 'custom' ? 'on' : ''}"><input type="radio" name="hook" value="custom" ${cur === 'custom' ? 'checked' : ''}>
        <span style="flex:1">My own hook (cover every syllable, first sound most vivid)<br>
        <textarea id="custom-hook" placeholder="Picture…">${esc(st.custom || '')}</textarea></span></label>`;
  }
  function readHookPicker(item) {
    const sel = $view.querySelector('input[name=hook]:checked'); if (!sel) return false;
    const st = itemState(item.id);
    const before = JSON.stringify([st.hook || 0, st.custom || '']);
    const txt = (($view.querySelector('#custom-hook') || {}).value || '').trim();
    if (sel.value === 'custom' && txt) { st.custom = txt; } else { delete st.custom; st.hook = sel.value === 'custom' ? 0 : +sel.value; }
    const changed = before !== JSON.stringify([st.hook || 0, st.custom || '']);
    if (changed) st.misses = 0; // a new hook gets a fresh start
    save(); return changed;
  }
  function wireHookPicker() {
    $view.querySelectorAll('.hook-opt').forEach(l => l.addEventListener('change', () => {
      $view.querySelectorAll('.hook-opt').forEach(x => x.classList.toggle('on', x.querySelector('input').checked));
    }));
    const ta = $view.querySelector('#custom-hook');
    if (ta) ta.addEventListener('input', () => { const r = ta.closest('.hook-opt').querySelector('input'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  $view.addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) { e.preventDefault(); speak(b.dataset.say); } });
  function studying(on) { document.body.classList.toggle('studying', !!on); }

  // ---------- Today ----------
  function estimateMin(n) { return Math.max(1, Math.round(n * SEC_REVIEW / 60)); }
  function plannedNew(due, evening) {
    if (!nextNew()) return 0;
    let cap = evening ? Math.min(5, newLeft()) : newLeft();
    if (due > 40) cap = 0;
    const timeCap = Math.floor((S.settings.rideMin * 60 - due * SEC_REVIEW) / (SEC_NEW + 2 * SEC_REVIEW));
    return Math.max(0, Math.min(cap, timeCap));
  }
  function viewToday() {
    studying(false);
    const due = dueCards().length, evening = isEvening();
    const nn = plannedNew(due, evening);
    const started = ITEMS.filter(i => introduced(i.id)).length;
    const lc = leeches().length, t = today();
    const mins = Math.min(S.settings.rideMin, estimateMin(due) + Math.round(nn * (SEC_NEW + 2 * SEC_REVIEW) / 60));
    const backupDue = started >= 10 && now() - (S.lastExport || 0) > 7 * DAY;
    render(`
      <h1>${evening ? 'Evening ride' : 'Morning ride'}</h1>
      <div class="stats">
        <div class="stat"><b>${due}</b><span>due now</span></div>
        <div class="stat"><b>${nn}</b><span>new this ride</span></div>
        <div class="stat"><b>${started}/${ITEMS.length}</b><span>started</span></div>
      </div>
      ${due || nn ? `<a class="btn primary block" href="#study">Start ride (about ${mins} min)</a>` :
        `<div class="card center"><p><b>All done for now.</b></p><p class="muted small">${nextRideText()}</p></div>`}
      ${lc ? `<a class="btn block" href="#fix">Fix ${plural(lc, 'weak hook')}</a>` : ''}
      ${backupDue ? `<a class="btn block" href="#settings">Back up your progress (last: ${S.lastExport ? new Date(S.lastExport).toLocaleDateString() : 'never'})</a>` : ''}
      <details class="card small" ${started ? '' : 'open'}><summary><b>How it works</b></summary>
        <p>1. <b>Hook:</b> each new word comes with a Sound, a Meaning and a scene to See. Really picture it for 5 seconds.</p>
        <p>2. <b>Recall:</b> see the English, say the Tamil out loud (a whisper counts), then check. Be honest with Again.</p>
        <p>3. <b>Fade:</b> the hook only comes back when you miss. Once a word holds for a week it is yours.</p>
        <p>Rides are capped at about ${S.settings.rideMin} minutes. Leftover reviews wait for the next ride.</p>
      </details>
      <p class="muted small center">Today: ${plural(t.new, 'new item')}, ${plural(t.reviews, 'review')}.</p>`);
  }
  function nextRide() {
    const d = new Date();
    if (!isEvening()) { d.setHours(17, 0, 0, 0); return { t: d.getTime(), when: 'This evening' }; }
    d.setDate(d.getDate() + 1); d.setHours(7, 30, 0, 0); return { t: d.getTime(), when: 'Tomorrow morning' };
  }
  function nextRideText() {
    const { t, when } = nextRide();
    const n = Object.values(S.cards).filter(c => c.due <= t).length;
    if (!n && !nextNew()) return 'Lesson complete. More lessons coming.';
    return `${when}: about ${plural(n, 'card')} (~${estimateMin(n)} min)${nextNew() ? ' plus new words' : ''}.`;
  }

  // ---------- study session ----------
  let session = null;
  function startStudy(forceNew) {
    const due = dueCards().length;
    session = { start: now(), budget: S.settings.rideMin * MIN, count: 0, nb: {}, done: 0, newShown: 0,
      newPlanned: forceNew ? Math.min(newLeft(), 5) : plannedNew(due, isEvening()), undo: null, last: null };
    studying(true);
    stepStudy();
  }
  const ready = cid => (session.nb[cid] || 0) <= session.count;
  function stepStudy() {
    session.count++;
    const left = session.budget - (now() - session.start);
    setTop(`~${Math.max(0, Math.ceil(left / MIN))} min left`);
    if (left <= 0) return showTimeUp();
    const due = dueCards().filter(ready);
    if (due.length) return showCard(due[0]);
    if (session.newShown < session.newPlanned && newLeft() > 0) {
      const it = nextNew();
      if (it) { session.newShown++; return showLearn(it); }
    }
    // end of ride: pull forward learning cards that are due soon, but only with a real gap
    const ahead = dueCards(LEARN_AHEAD).filter(cid => (S.cards[cid].learning || S.cards[cid].relearn) && ready(cid));
    if (ahead.length) return showCard(ahead[0]);
    showEnd();
  }
  function undoLink() { return session && session.undo ? `<button class="btn link undo" id="undo">↶ Undo last answer</button>` : ''; }
  function wireUndo() {
    const b = document.getElementById('undo'); if (!b) return;
    b.onclick = () => {
      const u = session.undo; if (!u) return;
      S.cards[u.cid] = u.card; S.items[u.id] = u.item; S.days[dayKey()] = u.day; session.done--; session.undo = null; save();
      showCard(u.cid);
    };
  }
  function showTimeUp() {
    render(`<h1>That’s your ride</h1><p>About ${S.settings.rideMin} minutes done, ${plural(session.done, 'card')} reviewed. Anything left waits for the next ride.</p>
      <button class="btn primary block" id="stop">Stop here</button>
      <button class="btn block" id="more">Keep going 5 more minutes</button>`);
    document.getElementById('stop').onclick = showEnd;
    document.getElementById('more').onclick = () => { session.budget += 5 * MIN; stepStudy(); };
  }
  function showEnd() {
    const lc = leeches().length;
    render(`<h1>Done for this ride ✓</h1><p>${plural(session.done, 'card')} reviewed, ${plural(session.newShown, 'new item')}.</p>
      <p class="muted">${nextRideText()}</p>
      ${lc ? `<a class="btn block" href="#fix">Fix ${plural(lc, 'weak hook')} (1 min)</a>` : ''}
      <a class="btn primary block" href="#today">Back to Today</a>${undoLink()}`);
    wireUndo();
    studying(false); setTop();
  }

  function showLearn(item) {
    const kindLabel = { word: 'New word', pattern: 'New pattern', phrase: 'New phrase' }[item.kind];
    let body = '';
    if (item.kind === 'word') {
      body = `${catBadge(item)}
        <div class="big">${esc(item.tamil)}${speakBtn(item.ta)}</div>${scriptLine(item.ta)}
        <div class="meaning">${esc(item.en)}</div>
        ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
        ${hookBlock(item)}
        ${picture(item, { small: true })}
        <p class="pron">🗣 ${esc(item.pron)} <a href="#sounds" class="small">how to read</a></p>
        ${item.set ? palaceSpotLine(item) : ''}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
        <details class="more"><summary>Other hooks, or write your own</summary>${hookPicker(item)}</details>`;
    } else if (item.kind === 'pattern') {
      const n = (item.drills || []).filter(d => (d[2] || []).every(id => introduced(id) || id === item.id)).length;
      body = `<div class="big">${esc(item.title)}</div><p>${esc(item.rule)}</p>
        <div class="hook">${esc(item.hook)}</div>${patternTable(item)}
        <p class="muted small">${n ? `Now ${plural(n, 'quick drill')}. Build each answer from the rule.` : 'Drills appear as you learn the words they use.'}</p>`;
    } else {
      body = `<div class="big">${esc(item.en)}</div><div class="answer">${esc(item.tamil)}${speakBtn(item.ta)}</div>${scriptLine(item.ta)}
        ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
        <h2>Built from</h2><div>${chips(item)}</div>
        <p class="muted small">Say the whole phrase out loud (or whisper it) twice.</p>`;
    }
    render(`<div class="prompt-label">${kindLabel}</div>
      <div class="card ${item.cat ? 'cat-' + item.cat : ''}">${body}
        <button class="btn link small know" id="skip">I already know this</button></div>
      <div class="sticky"><button class="btn primary block" id="go">Got it, test me later</button></div>`);
    if (item.kind === 'word') { wireHookPicker(); if (S.settings.autoplay) speak(item.ta); }
    if (item.kind === 'phrase' && S.settings.autoplay) speak(item.ta);
    document.getElementById('go').onclick = () => { if (item.kind === 'word') readHookPicker(item); introduce(item); stepStudy(); };
    const skip = document.getElementById('skip');
    skip.onclick = () => {
      if (!skip.dataset.armed) { skip.dataset.armed = '1'; skip.textContent = 'Tap again: skip it for a week'; return; }
      introduce(item);
      Object.keys(S.cards).filter(k => k.split(':')[0] === item.id).forEach(k => Object.assign(S.cards[k], { learning: false, ivl: 7, due: dayStart(now() + 7 * DAY) }));
      save(); stepStudy();
    };
  }

  function palaceSpotLine(item) {
    const p = DATA.palaces.find(x => x.id === item.set); if (!p) return '';
    const spot = (S.spots[p.id] || [])[item.spot] || p.spots[item.spot];
    return `<div class="note">🏛 Memory palace spot ${item.spot + 1}: <b>${esc(spot)}</b>. Put the scene there.</div>`;
  }

  function cardPrompt(cid) {
    const { item, dir, drill } = parseCid(cid);
    if (dir === 'd') { const d = item.drills[drill]; return { label: item.title, q: d[0], a: d[1], alts: [], ta: '' }; }
    if (dir === 'r') return { label: 'What does this mean?', q: item.tamil, a: item.en, alts: [], ta: item.ta, qSay: item.ta };
    return { label: item.kind === 'phrase' ? 'Say it in Tamil' : 'Tamil for…', q: item.en, a: item.tamil, alts: item.variants || [], ta: item.ta };
  }

  function showCard(cid) {
    const { item, dir } = parseCid(cid);
    const c = S.cards[cid], p = cardPrompt(cid);
    const learning = c.learning || c.relearn;
    const typing = S.settings.typing && dir !== 'r';
    const hint = dir === 'p' && item.kind === 'word' && !item.noImg;
    render(`${undoLink()}<div class="prompt-label">${esc(p.label)}${learning ? ' · learning' : ''}</div>
      <div class="card ${item.cat ? 'cat-' + item.cat : ''}"><div class="big">${esc(p.q)}${dir === 'r' ? speakBtn(p.qSay) : ''}</div>
        ${dir !== 'r' ? '<p class="muted small">Say it out loud (a whisper counts), then check.</p>' : ''}
        ${typing ? `<div class="typed"><input type="text" id="typed" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the Tamil (romanised)"></div>` : ''}
        ${hint ? '<button class="btn link small" id="hint">💡 Picture hint</button><div id="hintbox"></div>' : ''}
        <div id="reveal"></div></div>
      <div class="sticky" id="actions"><button class="btn primary block" id="show">Show answer</button></div>`);
    wireUndo();
    if (dir === 'r' && S.settings.autoplay) speak(p.qSay);
    const typed = document.getElementById('typed');
    if (typed) { typed.focus(); typed.addEventListener('keydown', e => { if (e.key === 'Enter') reveal(); }); }
    const hb = document.getElementById('hint');
    if (hb) hb.onclick = () => { document.getElementById('hintbox').innerHTML = picture(item, { small: true, noNote: true }); hb.remove(); };
    document.getElementById('show').onclick = reveal;

    function reveal() {
      const t = typed ? typed.value.trim() : '';
      let check = '';
      if (t) {
        const ok = [p.a, ...p.alts].some(a => norm(a) === norm(t));
        check = `<div class="check">${ok ? '✓ matches' : '≠ you typed “' + esc(t) + '”: compare carefully'}</div>`;
      }
      const isWord = item.kind === 'word' && dir !== 'd';
      // The hook comes back only while learning; on reviews it stays tucked away unless asked for.
      const showHookNow = isWord && learning;
      document.getElementById('reveal').innerHTML = `<hr class="rule">
        <div class="answer">${esc(p.a)}${dir !== 'r' ? speakBtn(p.ta) : ''}</div>${dir !== 'r' ? scriptLine(p.ta) : ''}
        ${p.alts.length ? `<div class="muted small">also: ${p.alts.map(esc).join(', ')}</div>` : ''}${check}
        ${isWord ? (showHookNow ? hookBlock(item) + `<p class="pron">🗣 ${esc(item.pron)}</p>` :
          `<button class="btn link small" id="peek">Show the hook</button><div id="hookbox" hidden>${hookBlock(item)}<p class="pron">🗣 ${esc(item.pron)}</p></div>`) : ''}
        ${item.kind === 'phrase' ? `<div>${chips(item)}</div>` : ''}`;
      if (dir !== 'r' && S.settings.autoplay) speak(p.ta);
      const peek = document.getElementById('peek');
      if (peek) peek.onclick = () => { document.getElementById('hookbox').hidden = false; peek.remove(); };
      const labels = learning ? ['Again', 'Hard', 'Good'] : ['Again', 'Hard', 'Good', 'Easy'];
      const cls = ['g-again', 'g-hard', 'g-good', 'g-easy'];
      document.getElementById('actions').innerHTML = `<div class="grades n${labels.length}">${labels.map((l, g) =>
        `<button class="btn ${cls[g]}" data-g="${g}">${l}<small>${fmtGap(preview(c, g))}</small></button>`).join('')}</div>`;
      document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => grade(+b.dataset.g));
    }
    function grade(g) {
      const id = item.id;
      session.undo = { cid, id, card: Object.assign({}, c), item: Object.assign({}, S.items[id] || {}), day: Object.assign({}, today()) };
      schedule(c, g); today().reviews++; session.done++;
      if (g === 0 && item.kind === 'word') itemState(id).misses = misses(id) + 1;
      session.nb[cid] = session.count + (g === 0 ? GAP_MISS : GAP_AFTER);
      save();
      if (g === 0 && item.kind !== 'phrase') return showMiss(item);
      stepStudy();
    }
  }

  function showMiss(item) {
    if (item.kind === 'pattern') {
      render(`${undoLink()}<div class="prompt-label">Missed: rebuild it from the rule</div>
        <div class="card"><div class="big">${esc(item.title)}</div><p>${esc(item.rule)}</p>${patternTable(item)}</div>
        <div class="sticky"><button class="btn primary block" id="next">Continue</button></div>`);
      wireUndo();
      document.getElementById('next').onclick = stepStudy;
      return;
    }
    const leech = isLeech(item);
    render(`${undoLink()}<div class="prompt-label">Missed</div>
      <div class="card ${item.cat ? 'cat-' + item.cat : ''}"><div class="big">${esc(item.tamil)}${speakBtn(item.ta)}</div><div class="meaning">${esc(item.en)}</div>
        <p><b>Before looking: what was the scene?</b> Try to picture it.</p>
        <div id="scene"></div>
        ${leech ? `<div class="leech">This hook has failed ${plural(misses(item.id), 'time')}. It’s on your <b>Fix weak hooks</b> list for after the ride.</div>` : ''}</div>
      <div class="sticky" id="actions"><button class="btn primary block" id="sc">Show the scene</button></div>`);
    wireUndo();
    document.getElementById('sc').onclick = () => {
      document.getElementById('scene').innerHTML = `${hookBlock(item)}${picture(item, { small: true })}<p class="pron">🗣 ${esc(item.pron)}</p>${item.set ? palaceSpotLine(item) : ''}`;
      document.getElementById('actions').innerHTML = '<button class="btn primary block" id="next">Continue</button>';
      document.getElementById('next').onclick = stepStudy;
    };
  }

  // ---------- fix weak hooks ----------
  function viewFix() {
    studying(false);
    const list = leeches();
    if (!list.length) { render(`<h1>Fix weak hooks</h1><p>No weak hooks right now. 🎉</p><a class="btn block" href="#today">Back to Today</a>`); return; }
    const item = list[0];
    const ch = hookChoice(item);
    const next = ch === 'custom' ? 0 : (ch + 1) % (item.alts.length + 1);
    render(`<h1>Fix weak hooks</h1><p class="muted small">${plural(list.length, 'word')} keep slipping. A failing hook means a weak image, not a weak memory. Pick another, or make it stranger, louder and funnier.</p>
      <div class="card ${item.cat ? 'cat-' + item.cat : ''}"><div class="big">${esc(item.tamil)}${speakBtn(item.ta)}</div><div class="meaning">${esc(item.en)}</div>
        <p class="muted small">Missed ${plural(misses(item.id), 'time')} with the current hook.</p>
        ${hookPicker(item, next)}</div>
      <div class="sticky"><button class="btn primary block" id="savefix">Use this hook</button></div>
      <a class="btn link" href="#today">Later</a>`);
    wireHookPicker();
    document.getElementById('savefix').onclick = () => {
      readHookPicker(item); itemState(item.id).misses = 0; save(); toast('New hook saved'); viewFix();
    };
  }

  // ---------- words ----------
  function viewWords(filter) {
    studying(false);
    filter = filter || 'all';
    const words = ITEMS.filter(i => i.kind === 'word');
    const phrases = ITEMS.filter(i => i.kind === 'phrase');
    const weak = words.filter(i => introduced(i.id) && misses(i.id) > 0).sort((a, b) => misses(b.id) - misses(a.id));
    const pick = { all: words, weak, phrases }[filter] || words;
    render(`<h1>Words</h1>
      <div class="filters">${[['all', 'All words'], ['weak', 'Weak spots'], ['phrases', 'Phrases']].map(([k, l]) =>
        `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${filter === 'weak' ? `<p class="muted small">Words you’ve missed since their hook last changed, worst first.${leeches().length ? ' <a href="#fix">Fix weak hooks</a>' : ''}</p>` : ''}
      ${pick.length ? `<ul class="list">${pick.map(i => {
        const s = stage(i);
        return `<li><a href="#item/${esc(i.id)}"><span><b>${esc(i.tamil)}</b> <span class="badge ${s.cls}">${s.label}</span>${filter === 'weak' ? ` <span class="badge warn">${plural(misses(i.id), 'miss', 'misses')}</span>` : ''}</span><span class="en">${esc(i.en)}</span></a></li>`;
      }).join('')}</ul>` : '<p class="muted">Nothing here yet.</p>'}`);
    $view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = b.dataset.f === 'all' ? '#words' : '#words/' + b.dataset.f; });
  }

  function viewItem(id) {
    studying(false);
    const item = BY_ID[id];
    if (!item) return viewWords();
    const cids = Object.keys(S.cards).filter(k => k.split(':')[0] === id);
    const stats = cids.length ? cids.map(k => { const st = S.cards[k], d = k.split(':')[1][0];
      return `<span class="badge">${d === 'p' ? 'EN→TA' : d === 'r' ? 'TA→EN' : 'drill'}: ${st.learning ? 'learning' : 'every ' + st.ivl + 'd'}</span>`; }).join('') : '<span class="badge">not started</span>';
    if (item.kind === 'phrase') {
      render(`<a href="#words/phrases" class="btn link">‹ Phrases</a><div class="card"><div class="big">${esc(item.en)}</div><div class="answer">${esc(item.tamil)}${speakBtn(item.ta)}</div>${scriptLine(item.ta)}
        <div>${chips(item)}</div><p>${stats}</p></div>`);
      return;
    }
    const s = stage(item);
    render(`<a href="#words" class="btn link">‹ Words</a>
      <div class="card ${item.cat ? 'cat-' + item.cat : ''}">${catBadge(item)}
      <div class="big">${esc(item.tamil)}${speakBtn(item.ta)}</div>${scriptLine(item.ta)}<div class="meaning">${esc(item.en)}</div>
      ${item.variants ? `<div class="muted small">also: ${item.variants.map(esc).join(', ')}</div>` : ''}
      <p><span class="badge ${s.cls}">${s.label}</span>${stats}${misses(id) ? `<span class="badge warn">${plural(misses(id), 'miss', 'misses')}</span>` : ''}</p>
      ${hookBlock(item)}${picture(item, { small: true })}<p class="pron">🗣 ${esc(item.pron)} <a href="#sounds" class="small">how to read</a></p>
      ${item.set ? palaceSpotLine(item) : ''}
      ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      <h2>Choose the hook</h2>${hookPicker(item)}
      <button class="btn primary block" id="save">Save hook</button>
      ${faded(item) ? '<button class="btn block" id="unfade">Keep showing the hook during reviews</button>' : ''}
      </div>`);
    wireHookPicker();
    document.getElementById('save').onclick = () => { readHookPicker(item); toast('Hook saved'); viewItem(id); };
    const uf = document.getElementById('unfade');
    if (uf) uf.onclick = () => { itemState(id).unfade = true; save(); viewItem(id); };
  }

  // ---------- patterns + sounds ----------
  function viewPatterns(scrollTo) {
    studying(false);
    const pats = ITEMS.filter(i => i.kind === 'pattern');
    render(`<h1>Patterns</h1>
      <div class="card" id="sounds"><h2 style="margin-top:0">How to read the spellings</h2>
        <dl class="guide">${(DATA.soundGuide || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${taVoice ? '' : '<p class="muted small">No Tamil voice found on this device, so the 🔊 buttons are hidden.</p>'}</div>
      <p class="muted">Learn the rule once, then build the forms. One rule unlocks many words.</p>
      ${pats.map(p => `<div class="card"><h2 style="margin-top:0">${esc(p.title)} ${introduced(p.id) ? '' : '<span class="badge">not yet</span>'}</h2>
        <p>${esc(p.rule)}</p><div class="hook">${esc(p.hook)}</div>${patternTable(p)}</div>`).join('')}`);
    if (scrollTo) { const el = document.getElementById(scrollTo); if (el) el.scrollIntoView(); }
  }

  // ---------- palaces ----------
  function viewPalaces(id, walk) {
    studying(false);
    if (id) return viewPalace(id, walk);
    render(`<h1>Memory palaces</h1><p class="muted">For sets of words, put each word at a spot in a place you know well, then walk through it in your head. Rename the spots to your real ones; your own places work far better than made-up ones.</p>
      ${DATA.palaces.map(p => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#palace/${esc(p.id)}">
        <b>${esc(p.title)}</b><br><span class="muted small">${plural(p.spots.length, 'spot')} · Lesson ${p.lesson}</span></a>`).join('')}`);
  }
  function viewPalace(id, walk) {
    const p = DATA.palaces.find(x => x.id === id); if (!p) return viewPalaces();
    const names = p.spots.map((s, i) => (S.spots[p.id] || [])[i] || s);
    const all = ITEMS.filter(i => i.set === p.id).sort((a, b) => a.spot - b.spot);
    const learned = all.filter(w => introduced(w.id));
    if (walk != null) {
      const i = +walk, w = learned[i];
      if (!w) { render(`<h1>Walk complete</h1><p class="muted">${learned.length < all.length ? 'More spots fill in as you learn their words.' : 'Every spot visited.'}</p><a class="btn primary block" href="#palace/${esc(id)}">Back</a>`); return; }
      render(`<a href="#palace/${esc(id)}" class="btn link">‹ ${esc(p.title)}</a>
        <div class="progress"><div style="width:${(i / learned.length) * 100}%"></div></div>
        <div class="card center"><div class="prompt-label">Spot ${w.spot + 1}</div><div class="big">${esc(names[w.spot])}</div>
        <p class="muted">What’s happening here? Say the Tamil word.</p><div id="rv"></div></div>
        <div class="sticky"><button class="btn primary block" id="rvb">Reveal</button></div>`);
      document.getElementById('rvb').onclick = function () {
        document.getElementById('rv').innerHTML = `<div class="answer">${esc(w.tamil)}${speakBtn(w.ta)}</div><div>${esc(w.en)}</div>${picture(w, { small: true, noNote: true })}<div style="text-align:left">${hookBlock(w)}</div>`;
        this.textContent = 'Next spot'; this.onclick = () => { location.hash = `#palace/${id}/${i + 1}`; };
      };
      return;
    }
    render(`<a href="#palaces" class="btn link">‹ Palaces</a><h1>${esc(p.title)}</h1><p>${esc(p.intro)}</p>
      <div class="card">${all.map(w => `<div class="spot"><span class="num">${w.spot + 1}</span>
        <div><input type="text" data-spot="${w.spot}" value="${esc(names[w.spot])}" aria-label="Spot ${w.spot + 1} name">
        <div class="small" style="margin-top:4px">${introduced(w.id) ? `<b>${esc(w.tamil)}</b> = ${esc(w.en)}` : '<span class="muted">(not learned yet)</span>'}</div></div></div>`).join('')}</div>
      ${learned.length ? `<a class="btn primary block" href="#palace/${esc(id)}/0">Walk through it (${plural(learned.length, 'spot')})</a>` : '<p class="muted">Learn some of these words first, then walk the palace.</p>'}`);
    $view.querySelectorAll('[data-spot]').forEach(inp => inp.addEventListener('change', () => {
      const arr = S.spots[p.id] = S.spots[p.id] || [];
      arr[+inp.dataset.spot] = inp.value.trim() || p.spots[+inp.dataset.spot]; save(); toast('Spot renamed');
    }));
  }

  // ---------- settings ----------
  function viewSettings() {
    studying(false);
    const st = S.settings;
    render(`<h1>Settings</h1>
      <div class="card">
        <label class="field">Minutes per ride<input type="number" id="ride" min="5" max="90" value="${st.rideMin}"></label>
        <label class="field">Most new items per day<input type="number" id="npd" min="1" max="60" value="${st.newPerDay}"></label>
        <p class="muted small">New words are cut back automatically when lots of reviews are due.</p>
        <label class="check-row"><input type="checkbox" id="typing" ${st.typing ? 'checked' : ''}><span>Type answers (optional, otherwise say them out loud)</span></label>
        <label class="check-row"><input type="checkbox" id="script" ${st.script ? 'checked' : ''}><span>Show Tamil script under the words</span></label>
        <label class="check-row"><input type="checkbox" id="autoplay" ${st.autoplay ? 'checked' : ''} ${taVoice ? '' : 'disabled'}><span>Speak words automatically ${taVoice ? '' : '(no Tamil voice on this device)'}</span></label>
        <p style="margin-top:12px">Theme</p>
        <div class="filters">${['auto', 'light', 'dark'].map(t => `<button data-theme-btn="${t}" class="${st.theme === t ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div>
      <div class="card">
        <b>Backup</b>
        <p class="muted small">Progress lives only in this browser. Export a backup now and then; clearing browser data would wipe it. Last backup: ${S.lastExport ? new Date(S.lastExport).toLocaleDateString() : 'never'}.</p>
        <button class="btn block" id="exp">Export backup</button>
        <label class="btn block" for="imp">Import backup</label><input type="file" id="imp" accept="application/json,.json" hidden>
      </div>
      <div class="card"><button class="btn block g-again" id="reset">Reset all progress</button></div>
      <p class="muted small center">Methods from <i>Moonwalking with Einstein</i>: elaborative encoding, memory palaces, chunking, plus spaced retrieval.</p>`);
    document.getElementById('ride').onchange = e => { st.rideMin = Math.max(5, Math.min(90, +e.target.value || 25)); save(); };
    document.getElementById('npd').onchange = e => { st.newPerDay = Math.max(1, Math.min(60, +e.target.value || 15)); save(); };
    ['typing', 'script', 'autoplay'].forEach(k => { document.getElementById(k).onchange = e => { st[k] = e.target.checked; save(); }; });
    $view.querySelectorAll('[data-theme-btn]').forEach(b => b.onclick = () => { st.theme = b.dataset.themeBtn; save(); applyTheme(); viewSettings(); });
    document.getElementById('exp').onclick = () => {
      S.lastExport = now(); save();
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tamil-backup-${dayKey()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      viewSettings();
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
    t.textContent = msg; t.setAttribute('role', 'status'); t.className = 'toast';
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
    const tab = { study: 'today', fix: 'today', item: 'words', palace: 'palaces', sounds: 'patterns' }[name] || name;
    document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    if (name !== 'study') { session = null; setTop(); }
    if (name === 'study') return startStudy(a === 'new');
    if (name === 'fix') return viewFix();
    if (name === 'words') return viewWords(a);
    if (name === 'item') return viewItem(a);
    if (name === 'patterns') return viewPatterns();
    if (name === 'sounds') return viewPatterns('sounds');
    if (name === 'palaces') return viewPalaces();
    if (name === 'palace') return viewPalaces(a, b);
    if (name === 'settings') return viewSettings();
    return viewToday();
  }
  window.addEventListener('hashchange', route);
  applyTheme();
  syncDrills(); save();
  route();

  // ---------- offline ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'warm', urls: ITEMS.filter(i => i.kind === 'word' && !i.noImg).map(i => `img/${i.id}.webp`) });
    }).catch(() => {});
  }
  window.__tamil = { S: () => S, schedule, dueCards, nextNew, session: () => session }; // for tests
})();
