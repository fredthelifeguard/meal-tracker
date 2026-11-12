import * as N from './nutrition.js';

// ------------------------------------------------------------------ setup
const CFG = window.APP_CONFIG || {};
const DRIVE_FOLDER = 'Meal Tracker';
const DRIVE_FILE = 'meal-tracker-data.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const LS = {
  state: 'meals.state', key: 'meals.lookupKey', token: 'meals.token', tokenExp: 'meals.tokenExp',
  connected: 'meals.connected', folderId: 'meals.folderId', fileId: 'meals.fileId',
  oauthState: 'meals.oauthState', silentTry: 'meals.silentTry', lastSync: 'meals.lastSync'
};
const TRACKING = [
  { k: 'water', label: 'Water', hint: 'Liters per day' },
  { k: 'times', label: 'Meal times', hint: 'Show and edit when each thing was eaten' },
  { k: 'notes', label: 'Portion notes', hint: 'A note on anything you log' },
  { k: 'weight', label: 'Weekly weight', hint: 'Record a weigh-in on any day' },
  { k: 'dose', label: 'Medication dose day', hint: 'Mark the days you take your dose' },
  { k: 'effects', label: 'Side effects', hint: 'Note how you felt' }
];
const HEALTH_KEYS = ['water', 'weight', 'dose', 'effects'];
const EFFECTS = ['Nausea', 'Constipation', 'Diarrhea', 'Heartburn', 'Fatigue', 'Low appetite'];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clone = (o) => JSON.parse(JSON.stringify(o));
const g = (n) => String(N.r1(n));
const today = () => N.ymd(new Date());
const nowTime = () => new Date().toTimeString().slice(0, 5);

function defaultSettings() {
  return {
    proteinGoal: 40, fiberGoal: 35, theme: 'auto', lookupKey: '',
    track: { water: false, times: false, notes: false, weight: false, dose: false, effects: false }, t: 0
  };
}
function normalize(s) {
  const out = { version: 1, settings: { ...defaultSettings(), ...(s && s.settings) } };
  out.settings.track = { ...defaultSettings().track, ...((s && s.settings && s.settings.track) || {}) };
  for (const c of N.COLLECTIONS) out[c] = (s && s[c] && typeof s[c] === 'object') ? s[c] : {};
  return out;
}

let state = normalize(null);
const ui = {
  tab: 'today', date: today(), meal: N.mealForHour(new Date().getHours() + new Date().getMinutes() / 60),
  busy: '', sheet: null, sync: 'off', exportFrom: N.addDays(today(), -29), exportTo: today(), lookup: ''
};
let authError = '';

// ------------------------------------------------------- local persistence
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('meal-tracker', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

async function loadLocal() {
  let saved = null;
  try { saved = await idb.get('state'); } catch (e) { /* fall through */ }
  if (!saved) { try { saved = JSON.parse(ls.get(LS.state) || 'null'); } catch (e) { saved = null; } }
  if (saved) state = normalize(saved);
}
let saveTimer = 0;
function saveLocalSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 200); }
async function saveLocal() {
  clearTimeout(saveTimer);
  try { await idb.set('state', state); }
  catch (e) { ls.set(LS.state, JSON.stringify(state)); }
}

function put(coll, id, rec) {
  rec.t = Date.now();
  state[coll][id] = rec;
  saveLocalSoon();
  scheduleSync(2500);
  return rec;
}
function setSettings(patch) {
  state.settings = { ...state.settings, ...patch, t: Date.now() };
  saveLocalSoon();
  scheduleSync(2500);
  applyTheme();
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ------------------------------------------------------------ food lookup
function lookupKey() { return String(state.settings.lookupKey || ls.get(LS.key) || '').trim(); }
function lookupErr(code, msg) { const e = new Error(msg); e.code = code; return e; }

async function api(path, body) {
  const base = String(CFG.lookupUrl || '').replace(/\/+$/, '');
  if (!base || !lookupKey()) throw lookupErr('setup', 'Food lookup is not set up yet. Add the passphrase in Settings.');
  if (!navigator.onLine) throw lookupErr('offline', 'You are offline, so this food could not be looked up.');
  let res;
  try {
    res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-App-Key': lookupKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw lookupErr('fail', 'The lookup service could not be reached.'); }
  if (res.status === 401) throw lookupErr('auth', 'The lookup passphrase was not accepted. Check it in Settings.');
  if (!res.ok) throw lookupErr('fail', 'The lookup did not work this time.');
  return res.json();
}

function itemFromFood(key, food, qty) {
  return {
    key, name: food.name, unit: food.unit, qty,
    p1: food.p1, f1: food.f1, k1: food.k1 || 0, source: food.source, estimate: !!food.estimate
  };
}

// Text -> items. Every answer is saved, so the same food is never looked up twice:
// "t:" records remember how a typed phrase splits into foods, "f:" records hold each food's numbers.
async function lookupText(text) {
  const tk = 't:' + N.textKey(text);
  const known = state.foods[tk];
  if (known && !known.deleted && known.parts.every((p) => state.foods[p.key] && !state.foods[p.key].deleted)) {
    return known.parts.map((p) => itemFromFood(p.key, state.foods[p.key], p.qty));
  }
  let parsed;
  try { parsed = (await api('/parse', { text })).items; }
  catch (e) {
    if (e.code !== 'fail') throw e;
    parsed = N.parseQuick(text);   // the service is up but Claude is not: split it ourselves
  }
  if (!parsed || !parsed.length) throw lookupErr('fail', 'That did not look like a food.');
  const keys = parsed.map((p) => 'f:' + N.foodKey(p.name, p.unit));
  const missing = parsed.map((p, i) => i).filter((i) => !state.foods[keys[i]] || state.foods[keys[i]].deleted);
  if (missing.length) {
    const res = await api('/resolve', { items: missing.map((i) => parsed[i]) });
    res.items.forEach((r, j) => {
      const i = missing[j];
      put('foods', keys[i], {
        name: r.name || parsed[i].name, unit: r.unit || parsed[i].unit, p1: r.p1, f1: r.f1, k1: r.k1, g1: r.g1,
        source: r.source, sourceName: r.sourceName, estimate: r.estimate
      });
    });
  }
  put('foods', tk, { parts: parsed.map((p, i) => ({ key: keys[i], qty: p.qty })) });
  return parsed.map((p, i) => itemFromFood(keys[i], state.foods[keys[i]], p.qty));
}

// ----------------------------------------------------------------- logging
function entriesOn(date, meal) {
  return Object.values(state.entries)
    .filter((e) => !e.deleted && e.date === date && (!meal || e.meal === meal))
    .sort((a, b) => (a.c || 0) - (b.c || 0));
}
function logEntry(name, items, extra = {}) {
  const id = uid();
  put('entries', id, {
    id, date: ui.date, meal: ui.meal, time: ui.date === today() ? nowTime() : '', name, items: clone(items),
    portion: 1, note: '', c: Date.now(), ...extra
  });
  render();
  toast(`Logged to ${N.SLOT_LABEL[ui.meal].toLowerCase()}`, { label: 'Adjust', fn: () => openSheet('entry', id) });
  return id;
}

async function addFromText(text) {
  text = text.trim();
  if (!text || ui.busy) return;
  ui.busy = text;
  render();
  try {
    const items = await lookupText(text);
    ui.busy = '';
    const id = logEntry(items.length === 1 ? items[0].name : text, items);
    if (items.some((i) => i.source === 'none')) {
      openSheet('entry', id);
      toast('No numbers found for that. Enter them here.');
    }
  } catch (e) {
    ui.busy = '';
    // Still log it, so nothing is lost; the numbers can be typed in by hand.
    const id = logEntry(text, [{ name: text, unit: 'serving', qty: 1, p1: 0, f1: 0, k1: 0, source: 'manual', estimate: false }]);
    openSheet('entry', id);
    toast(e.message + ' Enter the numbers yourself for now.');
  }
}

function recentFoods() {
  const seen = new Set();
  const out = [];
  const list = Object.values(state.entries).filter((e) => !e.deleted && !e.gotoId && e.items && e.items.length === 1)
    .sort((a, b) => (b.c || 0) - (a.c || 0));
  for (const e of list) {
    const it = e.items[0];
    const k = it.key || it.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= 8) break;
  }
  return out;
}
function gotoList() {
  const used = {};
  for (const e of Object.values(state.entries)) if (e.gotoId && !e.deleted) used[e.gotoId] = Math.max(used[e.gotoId] || 0, e.c || 0);
  return Object.values(state.gotos).filter((x) => !x.deleted)
    .sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0) || a.name.localeCompare(b.name));
}

function saveAsGoto(entries, fallbackName) {
  const items = N.gotoItemsFrom(entries);
  if (!items.length) return;
  const id = uid();
  const name = entries.length === 1 && entries[0].name ? entries[0].name : fallbackName;
  put('gotos', id, { id, name, items });
  render();
  toast(`Saved "${name}" as a go-to`, { label: 'Rename', fn: () => openSheet('goto', id) });
}

function remove(coll, id, label) {
  const old = state[coll][id];
  if (!old) return;
  put(coll, id, { id, deleted: true });
  closeSheet();
  render();
  toast(`${label} deleted`, { label: 'Undo', fn: () => { put(coll, id, old); render(); } });
}

// ---------------------------------------------------------- Google sign-in
function clientId() { return String(CFG.googleClientId || '').trim(); }
function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function token() { return Number(ls.get(LS.tokenExp)) > Date.now() ? ls.get(LS.token) : null; }
function clearToken() { ls.del(LS.token); ls.del(LS.tokenExp); }

function startAuth(silent) {
  if (!clientId()) return;
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ls.set(LS.oauthState, st);
  const p = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token',
    scope: SCOPE, state: st, include_granted_scopes: 'true'
  });
  if (silent) { p.set('prompt', 'none'); ls.set(LS.silentTry, String(Date.now())); }
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}

// The address can carry two things after "#": Google's sign-in result, or a one-time
// "#key=..." setup link that stores the lookup passphrase on this device.
function consumeHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return;
  const p = new URLSearchParams(h);
  if (p.get('key')) {
    history.replaceState(null, '', location.pathname + location.search);
    ls.set(LS.key, p.get('key'));
    return 'key';
  }
  if (!/(^|&)(access_token|error)=/.test(h)) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('state') !== ls.get(LS.oauthState)) return;
  ls.del(LS.oauthState);
  if (p.get('access_token')) {
    const secs = Number(p.get('expires_in')) || 3600;
    ls.set(LS.token, p.get('access_token'));
    ls.set(LS.tokenExp, String(Date.now() + (secs - 90) * 1000));
    ls.set(LS.connected, '1');
  } else {
    const err = p.get('error') || '';
    if (!/required|login/.test(err)) authError = err;   // "interaction_required" just means no silent renewal
  }
}

function disconnect() {
  clearToken();
  for (const k of [LS.connected, LS.folderId, LS.fileId, LS.lastSync, LS.silentTry]) ls.del(k);
  setSync('auth');
}

// ------------------------------------------------------------ Google Drive
class AuthError extends Error {}

async function gfetch(url, opts = {}) {
  const tk = token();
  if (!tk) throw new AuthError('Not signed in');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tk } });
  if (res.status === 401) { clearToken(); throw new AuthError('Sign-in expired'); }
  if (!res.ok) { const err = new Error('Google Drive error ' + res.status); err.status = res.status; throw err; }
  return res;
}
async function driveFind(q) {
  const url = API + '/files?spaces=drive&pageSize=5&fields=files(id,name)&q=' + encodeURIComponent(q);
  const data = await (await gfetch(url)).json();
  return data.files && data.files[0] ? data.files[0].id : null;
}
async function ensureFolder() {
  let id = ls.get(LS.folderId);
  if (id) return id;
  id = await driveFind(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  if (!id) {
    const res = await gfetch(API + '/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
    });
    id = (await res.json()).id;
  }
  ls.set(LS.folderId, id);
  return id;
}
async function uploadNew(name, folderId, blob) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob);
  const res = await gfetch(UPLOAD + '/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  return (await res.json()).id;
}

let syncing = false;
let syncQueued = false;
let syncTimer = 0;
function scheduleSync(delay) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, delay); }

async function sync(retried) {
  clearTimeout(syncTimer);
  if (!clientId()) return setSync('off');
  if (!ls.get(LS.connected)) return setSync('auth');
  if (!navigator.onLine) return setSync('offline');
  if (!token()) return setSync('expired');
  if (syncing) { syncQueued = true; return; }
  syncing = true;
  setSync('syncing');
  let retry = false;
  try {
    const folderId = await ensureFolder();
    let fileId = ls.get(LS.fileId) || await driveFind(`name='${DRIVE_FILE}' and '${folderId}' in parents and trashed=false`);
    let remote = null;
    if (fileId) remote = await (await gfetch(`${API}/files/${fileId}?alt=media`)).json();
    // No awaits between reading `state` and replacing it, so edits made mid-sync are never lost.
    const { merged, localChanged, remoteStale } = N.mergeStates(state, remote);
    state = normalize(merged);
    const body = new Blob([JSON.stringify(state)], { type: 'application/json' });
    if (localChanged) { await saveLocal(); applyTheme(); if (!$('#sheet').open) render(); }
    if (!fileId) fileId = await uploadNew(DRIVE_FILE, folderId, body);
    else if (remoteStale) {
      await gfetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body
      });
    }
    ls.set(LS.fileId, fileId);
    ls.set(LS.lastSync, String(Date.now()));
    setSync('ok');
  } catch (e) {
    if (e instanceof AuthError) setSync('expired');
    else if (e.status === 404 && !retried) { ls.del(LS.fileId); ls.del(LS.folderId); retry = true; }
    else { console.error(e); setSync(navigator.onLine ? 'error' : 'offline'); }
  } finally {
    syncing = false;
  }
  if (retry) return sync(true);
  if (syncQueued) { syncQueued = false; scheduleSync(500); }
}
function setSync(s) {
  ui.sync = s;
  if (ui.tab === 'settings' && !$('#sheet').open) {
    const el = $('#syncBox');
    if (el) el.innerHTML = syncBoxHtml();
  }
}

// ---------------------------------------------------------------- rendering
function dateTitle(d) {
  if (d === today()) return 'Today';
  if (d === N.addDays(today(), -1)) return 'Yesterday';
  return N.fromYmd(d).toLocaleDateString(undefined, { weekday: 'long' });
}
function dateSub(d) { return N.fromYmd(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function shortDate(d) { return N.fromYmd(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

function headHtml() {
  const atToday = ui.date >= today();
  return `
    <header class="top">
      <button type="button" class="day-btn" data-act="day" data-d="-1" aria-label="Previous day">&#8249;</button>
      <div class="top-title">
        <h1>${esc(dateTitle(ui.date))}</h1>
        <p>${esc(dateSub(ui.date))}</p>
      </div>
      <button type="button" class="day-btn" data-act="day" data-d="1" aria-label="Next day" ${atToday ? 'disabled' : ''}>&#8250;</button>
    </header>`;
}

const RING = 2 * Math.PI * 44;
function plateHtml(meal, value, goal) {
  value = Math.round(value);          // the plate shows whole grams, so judge the goal on what is shown
  const p = N.progress(value, goal);
  const met = value >= goal && goal > 0;
  return `
    <button type="button" class="plate${met ? ' met' : ''}" data-act="meal" data-meal="${meal}" aria-pressed="${ui.meal === meal}"
      aria-label="${N.SLOT_LABEL[meal]}: ${g(value)} of ${g(goal)} grams of protein. Log to ${N.SLOT_LABEL[meal].toLowerCase()}.">
      <span class="plate-dish">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ring-track" cx="50" cy="50" r="44"/>
          <circle class="ring-fill" cx="50" cy="50" r="44" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="${(RING * (1 - p)).toFixed(2)}"/>
        </svg>
        <span class="plate-num">${g(Math.round(value))}</span>
        <span class="plate-of">of ${g(goal)}g</span>
      </span>
      <span class="plate-name">${N.SLOT_LABEL[meal]}</span>
    </button>`;
}

function rowNums(t) { return `<b>${g(t.protein)}g</b> protein, <b>${g(t.fiber)}g</b> fiber`; }
function estTag(items) {
  return (items || []).some((i) => i.estimate && !i.skip) ? '<span class="tag">estimate</span>' : '';
}

function renderToday() {
  const s = state.settings;
  const t = N.dayTotals(state.entries, ui.date);
  const fiberMet = t.fiber >= s.fiberGoal && s.fiberGoal > 0;
  const gotos = gotoList().slice(0, 12);
  const recents = recentFoods();
  const groups = N.SLOTS.map((slot) => {
    const list = entriesOn(ui.date, slot);
    if (!list.length) return '';
    const fiber = list.reduce((a, e) => a + N.entryTotals(e).fiber, 0);
    return `
      <section class="group">
        <div class="group-head">
          <h2>${N.SLOT_LABEL[slot]}</h2>
          <span class="group-sum">${g(t.protein[slot])}g protein, ${g(fiber)}g fiber</span>
          <button type="button" class="link" data-act="saveMeal" data-meal="${slot}">Save as go-to</button>
        </div>
        <ul class="rows">${list.map((e) => {
          const et = N.entryTotals(e);
          const bits = [];
          if (e.portion === 0.5) bits.push('half portion');
          if (e.portion === 2) bits.push('double portion');
          if (e.items.length === 1 && e.items[0].qty !== 1) bits.push(N.fmtAmount(e.items[0]));
          if (e.items.some((i) => i.skip)) bits.push('adjusted');
          if (s.track.times && e.time) bits.push(e.time);
          if (s.track.notes && e.note) bits.push(e.note);
          return `<li><button type="button" class="row" data-act="entry" data-id="${e.id}">
            <span class="row-main"><span class="row-name">${esc(e.name)}</span>${estTag(e.items)}</span>
            ${bits.length ? `<span class="row-sub">${esc(bits.join(', '))}</span>` : ''}
            <span class="row-nums">${rowNums(et)}</span>
          </button></li>`;
        }).join('')}</ul>
      </section>`;
  }).join('');

  $('#view').innerHTML = `
    ${headHtml()}
    <section class="plates" aria-label="Protein per meal">
      ${N.MEALS.map((m) => plateHtml(m, t.protein[m], s.proteinGoal)).join('')}
    </section>
    <section class="fiber${fiberMet ? ' met' : ''}" aria-label="Fiber for the day">
      <div class="fiber-line"><span class="fiber-name">Fiber</span><span class="fiber-num"><b>${g(t.fiber)}</b> of ${g(s.fiberGoal)}g</span></div>
      <div class="bar"><span style="width:${(N.progress(t.fiber, s.fiberGoal) * 100).toFixed(1)}%"></span></div>
    </section>

    <section class="add">
      <div class="seg" role="group" aria-label="Log to">
        ${N.SLOTS.map((m) => `<button type="button" data-act="meal" data-meal="${m}" aria-pressed="${ui.meal === m}">${N.SLOT_LABEL[m]}</button>`).join('')}
      </div>
      <form class="add-form" data-form="add">
        <input name="q" type="text" placeholder="What did you eat?" aria-label="What did you eat?" autocomplete="off" autocapitalize="none" enterkeyhint="go" ${ui.busy ? 'disabled' : ''}>
        <button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Add</button>
      </form>
      ${ui.busy ? `<p class="busy">Looking up "${esc(ui.busy)}"…</p>` : ''}
      ${gotos.length ? `<h3>Go-tos</h3><div class="chips">${gotos.map((x) =>
        `<button type="button" class="chip goto" data-act="logGoto" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      ${recents.length ? `<h3>Recent</h3><div class="chips">${recents.map((it, i) =>
        `<button type="button" class="chip" data-act="logRecent" data-i="${i}">${it.qty !== 1 ? esc(N.fmtQty(it.qty)) + ' ' : ''}${esc(it.name)}</button>`).join('')}</div>` : ''}
    </section>

    ${groups || `<p class="empty">Nothing logged ${ui.date === today() ? 'yet today' : 'on this day'}. Type what you ate, or tap a go-to.</p>`}`;
}

function renderGotos() {
  const list = gotoList();
  $('#view').innerHTML = `
    <header class="top plain"><div class="top-title"><h1>Go-tos</h1><p>Meals you eat on rotation. Tap one on Today to log it.</p></div></header>
    <button type="button" class="btn primary wide" data-act="newGoto">New go-to</button>
    ${list.length ? `<ul class="rows spaced">${list.map((x) => {
      const t = N.entryTotals({ items: x.items });
      return `<li><button type="button" class="row" data-act="goto" data-id="${x.id}">
        <span class="row-main"><span class="row-name">${esc(x.name)}</span>${estTag(x.items)}</span>
        <span class="row-sub">${esc(x.items.map((i) => i.name).join(', ') || 'No ingredients yet')}</span>
        <span class="row-nums">${rowNums(t)}</span>
      </button></li>`;
    }).join('')}</ul>` : '<p class="empty">No go-tos yet. Make one here, or tap "Save as go-to" on a meal you have logged.</p>'}`;
}

function dayRec(date) { return state.days[date] || {}; }
function setDay(patch) { put('days', ui.date, { ...dayRec(ui.date), ...patch }); render(); }

function renderHealth() {
  const tr = state.settings.track;
  const d = dayRec(ui.date);
  const lastWeight = Object.entries(state.days).filter(([k, v]) => v.weight && k < ui.date).sort((a, b) => b[0].localeCompare(a[0]))[0];
  const effects = String(d.effects || '').split(',').map((x) => x.trim()).filter(Boolean);
  const other = effects.filter((x) => !EFFECTS.includes(x)).join(', ');
  $('#view').innerHTML = `
    ${headHtml()}
    ${tr.water ? `<section class="card">
      <h2>Water</h2>
      <p class="water-total"><b>${N.fmtLiters(N.waterMl(d))}</b> L</p>
      <div class="chips center">
        <button type="button" class="chip goto" data-act="water" data-ml="500">+ 500 mL</button>
        <button type="button" class="chip goto" data-act="water" data-ml="1000">+ 1 L</button>
      </div>
      <div class="btn-row center">
        <button type="button" class="link" data-act="water" data-ml="-250" ${N.waterMl(d) ? '' : 'disabled'}>Take off 250 mL</button>
      </div>
    </section>` : ''}
    ${tr.weight ? `<section class="card">
      <h2>Weight</h2>
      <label class="field inline"><input type="number" inputmode="decimal" step="0.1" min="0" data-day="weight" value="${d.weight || ''}" placeholder="0.0" aria-label="Weight in pounds"><span>lb</span></label>
      <p class="hint">${lastWeight ? `Last recorded ${g(lastWeight[1].weight)} lb on ${esc(shortDate(lastWeight[0]))}.` : 'Record it on the day you weigh in.'}</p>
    </section>` : ''}
    ${tr.dose ? `<section class="card">
      <h2>Medication</h2>
      <button type="button" class="toggle" data-act="dose" aria-pressed="${!!d.dose}">${d.dose ? 'Dose taken this day' : 'Mark as dose day'}</button>
      ${d.dose ? `<label class="field"><span>Dose</span><input type="text" data-day="doseNote" value="${esc(d.doseNote || '')}" placeholder="e.g. 0.5 mg"></label>` : ''}
    </section>` : ''}
    ${tr.effects ? `<section class="card">
      <h2>Side effects</h2>
      <div class="chips">${EFFECTS.map((x) => `<button type="button" class="chip pick" data-act="effect" data-x="${x}" aria-pressed="${effects.includes(x)}">${x}</button>`).join('')}</div>
      <label class="field"><span>Anything else</span><input type="text" data-day="effectsOther" value="${esc(other)}" placeholder="In your own words"></label>
    </section>` : ''}
    <p class="hint center">Meal times and portion notes appear on each food when you tap it.</p>`;
}

function syncBoxHtml() {
  const last = Number(ls.get(LS.lastSync));
  const when = last ? new Date(last).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const msg = {
    off: 'Drive sync is not configured.',
    auth: 'Your data is saved on this device only. Connect Google Drive to back it up and share it between devices.',
    expired: 'Google sign-in has lapsed. Changes are saved on this device and will sync after you reconnect.',
    offline: 'Offline. Changes are saved on this device and will sync later.',
    syncing: 'Syncing with Google Drive…',
    ok: `Synced with Google Drive${when ? ' at ' + when : ''}.`,
    error: 'Google Drive sync did not work this time. It will try again on the next change.'
  }[ui.sync] || '';
  const connected = !!ls.get(LS.connected);
  return `<p class="hint">${esc(msg)}${authError ? ' Google said: ' + esc(authError) : ''}</p>
    <div class="btn-row">
      ${!connected || ui.sync === 'expired' ? `<button type="button" class="btn primary" data-act="connect">${connected ? 'Reconnect Drive' : 'Connect Drive'}</button>` : `<button type="button" class="btn" data-act="syncNow">Sync now</button>`}
      ${connected ? '<button type="button" class="btn quiet" data-act="disconnect">Disconnect</button>' : ''}
    </div>`;
}

function renderSettings() {
  const s = state.settings;
  $('#view').innerHTML = `
    <header class="top plain"><div class="top-title"><h1>Settings</h1></div></header>
    <section class="card">
      <h2>Goals</h2>
      <label class="field inline"><span class="grow">Protein per meal</span><input type="number" inputmode="decimal" min="1" max="300" data-set="proteinGoal" value="${g(s.proteinGoal)}"><span>g</span></label>
      <label class="field inline"><span class="grow">Fiber per day</span><input type="number" inputmode="decimal" min="1" max="200" data-set="fiberGoal" value="${g(s.fiberGoal)}"><span>g</span></label>
    </section>
    <section class="card">
      <h2>Appearance</h2>
      <div class="seg" role="group" aria-label="Appearance">
        ${[['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-act="theme" data-k="${k}" aria-pressed="${s.theme === k}">${l}</button>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Also track</h2>
      <p class="hint">Off by default. Anything you turn on lives on its own Health tab, never on the main screen.</p>
      ${TRACKING.map((x) => `<label class="switch"><span><b>${x.label}</b><small>${x.hint}</small></span><input type="checkbox" data-track="${x.k}" ${s.track[x.k] ? 'checked' : ''}></label>`).join('')}
    </section>
    <section class="card">
      <h2>Export for appointments</h2>
      <div class="two">
        <label class="field"><span>From</span><input type="date" data-exp="exportFrom" value="${ui.exportFrom}"></label>
        <label class="field"><span>To</span><input type="date" data-exp="exportTo" value="${ui.exportTo}"></label>
      </div>
      <div class="btn-col">
        <button type="button" class="btn" data-act="print">Print summary</button>
        <button type="button" class="btn" data-act="csvDaily">Daily summary (CSV)</button>
        <button type="button" class="btn" data-act="csvFood">Full food log (CSV)</button>
      </div>
    </section>
    <section class="card">
      <h2>Food lookup</h2>
      <p class="hint">Foods are looked up in Open Food Facts and USDA FoodData Central, then estimated by Claude if neither has them. Only the food text is sent.</p>
      <label class="field"><span>Passphrase</span><input type="password" data-set="lookupKey" value="${esc(lookupKey())}" autocomplete="off" placeholder="From your setup notes"></label>
      <div class="btn-row"><button type="button" class="btn" data-act="checkLookup">Check connection</button><span class="hint" id="lookupStatus">${esc(ui.lookup)}</span></div>
    </section>
    <section class="card">
      <h2>Backup and sync</h2>
      <div id="syncBox">${syncBoxHtml()}</div>
    </section>
    <p class="hint center">Everything you log stays on your devices and in your own Google Drive.</p>`;
}

function render() {
  const tr = state.settings.track;
  const healthOn = HEALTH_KEYS.some((k) => tr[k]);
  if (ui.tab === 'health' && !healthOn) ui.tab = 'today';
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.tab === 'health') b.hidden = !healthOn;
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  ({ today: renderToday, gotos: renderGotos, health: renderHealth, settings: renderSettings })[ui.tab]();
}

// ------------------------------------------------------------------ sheets
// One bottom sheet edits either a logged entry or a saved go-to; both are a named list of items.
function sheetRec() {
  if (!ui.sheet) return null;
  const rec = state[ui.sheet.kind === 'entry' ? 'entries' : 'gotos'][ui.sheet.id];
  return rec && !rec.deleted ? rec : null;
}
function saveSheetRec(rec) {
  put(ui.sheet.kind === 'entry' ? 'entries' : 'gotos', rec.id, rec);
  renderSheet();
  render();
}
function openSheet(kind, id) {
  ui.sheet = { kind, id, swap: -1, busy: false };
  renderSheet();
  const d = $('#sheet');
  if (!d.open) d.showModal();
}
function closeSheet() {
  const d = $('#sheet');
  if (d.open) d.close();
  ui.sheet = null;
}

const SOURCE_LABEL = { off: 'Open Food Facts', usda: 'USDA', claude: 'Claude estimate', manual: 'Entered by hand', none: 'No numbers found' };
function stepFor(unit) { return /^(g|gram|ml)$/.test(unit) ? 10 : /^(oz|ounce)$/.test(unit) ? 1 : 0.5; }

function itemHtml(it, i, rec) {
  const isEntry = ui.sheet.kind === 'entry';
  const t = N.itemTotals({ ...it, skip: false });
  const src = it.edited ? 'Corrected by you' : (SOURCE_LABEL[it.source] || '');
  if (ui.sheet.swap === i) {
    return `<li class="item"><form class="add-form" data-form="swap" data-i="${i}">
      <input name="q" type="text" placeholder="Swap ${esc(it.name)} for…" aria-label="Swap for" autocomplete="off" autocapitalize="none" ${ui.sheet.busy ? 'disabled' : ''}>
      <button type="submit" class="btn primary" ${ui.sheet.busy ? 'disabled' : ''}>${ui.sheet.busy ? 'Looking…' : 'Swap'}</button>
    </form><button type="button" class="link" data-act="swapCancel">Keep ${esc(it.name)}</button></li>`;
  }
  return `<li class="item${it.skip ? ' skipped' : ''}">
    <div class="item-head">
      <span class="item-name">${esc(it.name)}${it.estimate ? ' <span class="tag">estimate</span>' : ''}</span>
      <span class="item-src">${esc(it.skip ? 'Left out this time' : src)}</span>
    </div>
    ${it.skip ? '' : `<div class="item-grid">
      <div class="stepper">
        <button type="button" data-act="qty" data-i="${i}" data-d="-1" aria-label="Less">&minus;</button>
        <span>${esc(N.fmtAmount(it))}</span>
        <button type="button" data-act="qty" data-i="${i}" data-d="1" aria-label="More">+</button>
      </div>
      <label class="num"><span>Protein</span><input type="number" inputmode="decimal" min="0" step="0.1" data-item="${i}" data-f="protein" value="${g(t.protein)}"><i>g</i></label>
      <label class="num"><span>Fiber</span><input type="number" inputmode="decimal" min="0" step="0.1" data-item="${i}" data-f="fiber" value="${g(t.fiber)}"><i>g</i></label>
    </div>`}
    <div class="item-acts">
      ${isEntry && (rec.items.length > 1 || it.skip) ? `<button type="button" class="link" data-act="skip" data-i="${i}">${it.skip ? 'Put back' : 'Leave out'}</button>` : ''}
      ${it.skip ? '' : `<button type="button" class="link" data-act="swap" data-i="${i}">Swap</button>`}
      ${!isEntry ? `<button type="button" class="link" data-act="dropItem" data-i="${i}">Remove</button>` : ''}
    </div>
  </li>`;
}

function renderSheet() {
  const rec = sheetRec();
  const d = $('#sheet');
  if (!rec) { if (d.open) d.close(); return; }
  const isEntry = ui.sheet.kind === 'entry';
  const t = N.entryTotals(isEntry ? rec : { items: rec.items });
  const tr = state.settings.track;
  const keepScroll = d.scrollTop;
  d.innerHTML = `
    <div class="sheet-head">
      ${isEntry ? `<h2 id="sheetTitle">${esc(rec.name)}</h2>`
        : `<label class="field grow"><span>Name</span><input type="text" data-rec="name" value="${esc(rec.name)}" aria-label="Go-to name"></label>`}
      <button type="button" class="btn primary" data-act="close">Done</button>
    </div>
    <div class="sheet-totals"><span><b>${g(t.protein)}g</b> protein</span><span><b>${g(t.fiber)}g</b> fiber</span></div>

    ${isEntry ? `
      <h3>Portion</h3>
      <div class="seg" role="group" aria-label="Portion">
        ${[[0.5, 'Half'], [1, 'Full'], [2, 'Double']].map(([v, l]) => `<button type="button" data-act="portion" data-v="${v}" aria-pressed="${(rec.portion == null ? 1 : rec.portion) === v}">${l}</button>`).join('')}
      </div>
      <h3>Meal</h3>
      <div class="seg" role="group" aria-label="Meal">
        ${N.SLOTS.map((m) => `<button type="button" data-act="moveMeal" data-meal="${m}" aria-pressed="${rec.meal === m}">${N.SLOT_LABEL[m]}</button>`).join('')}
      </div>` : ''}

    <h3>${isEntry ? (rec.items.length > 1 ? 'Ingredients, just for this time' : 'Amount and numbers') : 'Ingredients'}</h3>
    <ul class="items">${rec.items.map((it, i) => itemHtml(it, i, rec)).join('') || '<li class="hint">Nothing here yet.</li>'}</ul>
    ${!isEntry ? `<form class="add-form" data-form="ingredient">
      <input name="q" type="text" placeholder="Add an ingredient, e.g. 1 cup spinach" aria-label="Add an ingredient" autocomplete="off" autocapitalize="none" ${ui.sheet.busy ? 'disabled' : ''}>
      <button type="submit" class="btn primary" ${ui.sheet.busy ? 'disabled' : ''}>${ui.sheet.busy ? 'Looking…' : 'Add'}</button>
    </form>` : ''}

    ${isEntry && tr.times ? `<label class="field inline"><span class="grow">Time eaten</span><input type="time" data-rec="time" value="${esc(rec.time || '')}"></label>` : ''}
    ${isEntry && tr.notes ? `<label class="field"><span>Portion note</span><input type="text" data-rec="note" value="${esc(rec.note || '')}" placeholder="e.g. ate about two thirds"></label>` : ''}

    <div class="btn-row sheet-foot">
      ${isEntry ? '<button type="button" class="btn" data-act="entryToGoto">Save as go-to</button>' : ''}
      <button type="button" class="btn quiet" data-act="delete">${isEntry ? 'Delete' : 'Delete go-to'}</button>
    </div>`;
  d.scrollTop = keepScroll;
}

async function sheetLookup(text, apply) {
  text = text.trim();
  if (!text || !ui.sheet || ui.sheet.busy) return;
  const ctx = ui.sheet;
  ctx.busy = true;
  renderSheet();
  let items;
  try { items = await lookupText(text); }
  catch (e) {
    items = [{ name: text, unit: 'serving', qty: 1, p1: 0, f1: 0, k1: 0, source: 'manual', estimate: false }];
    toast(e.message + ' Enter the numbers yourself for now.');
  }
  ctx.busy = false;
  if (ui.sheet !== ctx) return;
  const rec = sheetRec();
  if (!rec) return;
  const next = clone(rec);
  apply(next, items);
  ctx.swap = -1;
  saveSheetRec(next);
}

// ------------------------------------------------------------------ export
function share(name, text, type) {
  const file = new File([text], name, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function rangeOk() {
  if (ui.exportFrom && ui.exportTo && ui.exportFrom > ui.exportTo) { toast('The "From" date is after the "To" date.'); return false; }
  return true;
}
function printSummary() {
  const s = state.settings;
  const daily = N.dailyRows(state, ui.exportFrom, ui.exportTo);
  const food = N.foodRows(state, ui.exportFrom, ui.exportTo);
  const tr = s.track;
  const keep = [0, 1, 2, 3, 5].concat(tr.water ? [6] : [], tr.weight ? [7] : [], tr.dose ? [8] : [], tr.effects ? [9] : []);
  const table = (rows, cols) => `<table><thead><tr>${cols.map((c) => `<th>${esc(rows[0][c])}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(1).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const days = daily.length - 1;
  const avg = (c) => (days ? g(daily.slice(1).reduce((a, r) => a + Number(r[c] || 0), 0) / days) : '0');
  $('#printArea').innerHTML = `
    <h1>Meal summary</h1>
    <p>${esc(dateSub(ui.exportFrom))} to ${esc(dateSub(ui.exportTo))}, ${days} day${days === 1 ? '' : 's'} with entries.</p>
    <p>Goals: ${g(s.proteinGoal)} g protein per meal, ${g(s.fiberGoal)} g fiber per day.
       Averages on logged days: breakfast ${avg(1)} g, lunch ${avg(2)} g, supper ${avg(3)} g protein; fiber ${avg(5)} g.</p>
    <h2>Each day</h2>${days ? table(daily, keep) : '<p>No entries in this range.</p>'}
    ${food.length > 1 ? `<h2>Food log</h2>${table(food, [0, 1].concat(tr.times ? [2] : [], [4, 5, 6, 7, 10], tr.notes ? [11] : []))}` : ''}
    <p class="fine">Entries marked "yes" under Estimate are estimates rather than database values.</p>`;
  window.print();
}

// ------------------------------------------------------------------- toast
let toastTimer = 0;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).onclick = () => { el.hidden = true; action.fn(); };
  // A modal sheet sits in the browser's top layer, so the toast has to live inside it to be seen.
  const sheet = $('#sheet');
  (sheet.open ? sheet : document.body).appendChild(el);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 4500);
}

// ------------------------------------------------------------------ events
const actions = {
  day(b) {
    const next = N.addDays(ui.date, Number(b.dataset.d));
    if (next <= today()) { ui.date = next; render(); }
  },
  meal(b) { ui.meal = b.dataset.meal; render(); },
  logGoto(b) {
    const x = state.gotos[b.dataset.id];
    if (x && x.items.length) logEntry(x.name, x.items, { gotoId: x.id });
    else if (x) openSheet('goto', x.id);
  },
  logRecent(b) {
    const it = recentFoods()[Number(b.dataset.i)];
    if (it) logEntry(it.name, [{ ...it, skip: false }]);
  },
  entry(b) { openSheet('entry', b.dataset.id); },
  goto(b) { openSheet('goto', b.dataset.id); },
  newGoto() {
    const id = uid();
    put('gotos', id, { id, name: 'New go-to', items: [] });
    render();
    openSheet('goto', id);
    const input = $('#sheet [data-rec="name"]');
    if (input) { input.focus(); input.select(); }
  },
  saveMeal(b) {
    const slot = b.dataset.meal;
    saveAsGoto(entriesOn(ui.date, slot), `${N.SLOT_LABEL[slot]}, ${shortDate(ui.date)}`);
  },
  close() { closeSheet(); },
  portion(b) { saveSheetRec({ ...sheetRec(), portion: Number(b.dataset.v) }); },
  moveMeal(b) { saveSheetRec({ ...sheetRec(), meal: b.dataset.meal }); },
  qty(b) {
    const rec = clone(sheetRec());
    const it = rec.items[Number(b.dataset.i)];
    const step = stepFor(it.unit);
    it.qty = Math.max(step, Math.round((it.qty + step * Number(b.dataset.d)) * 100) / 100);
    saveSheetRec(rec);
  },
  skip(b) {
    const rec = clone(sheetRec());
    const it = rec.items[Number(b.dataset.i)];
    it.skip = !it.skip;
    saveSheetRec(rec);
  },
  swap(b) { ui.sheet.swap = Number(b.dataset.i); renderSheet(); const i = $('#sheet [data-form="swap"] input'); if (i) i.focus(); },
  swapCancel() { ui.sheet.swap = -1; renderSheet(); },
  dropItem(b) {
    const rec = clone(sheetRec());
    rec.items.splice(Number(b.dataset.i), 1);
    saveSheetRec(rec);
  },
  entryToGoto() { const rec = sheetRec(); closeSheet(); saveAsGoto([rec], rec.name); },
  delete() {
    const kind = ui.sheet.kind;
    remove(kind === 'entry' ? 'entries' : 'gotos', ui.sheet.id, kind === 'entry' ? 'Entry' : 'Go-to');
  },
  water(b) { setDay({ waterMl: Math.max(0, N.waterMl(dayRec(ui.date)) + Number(b.dataset.ml)) }); },
  dose() { setDay({ dose: !dayRec(ui.date).dose }); },
  effect(b) {
    const cur = String(dayRec(ui.date).effects || '').split(',').map((x) => x.trim()).filter(Boolean);
    const x = b.dataset.x;
    setDay({ effects: (cur.includes(x) ? cur.filter((y) => y !== x) : cur.concat(x)).join(', ') });
  },
  theme(b) { setSettings({ theme: b.dataset.k }); render(); },
  connect() { startAuth(false); },
  disconnect() { disconnect(); },
  syncNow() { sync(); },
  async checkLookup() {
    const set = (m) => { ui.lookup = m; const el = $('#lookupStatus'); if (el) el.textContent = m; };
    set('Checking…');
    try {
      const r = await api('/health');
      set(r.claude && r.usda ? 'Connected.' : `Connected, but the ${!r.claude ? 'Claude' : 'USDA'} key is missing on the server.`);
    } catch (e) { set(e.message); }
  },
  print() { if (rangeOk()) printSummary(); },
  csvDaily() { if (rangeOk()) share(`meal-summary-${ui.exportFrom}-to-${ui.exportTo}.csv`, N.toCsv(N.dailyRows(state, ui.exportFrom, ui.exportTo)), 'text/csv'); },
  csvFood() { if (rangeOk()) share(`food-log-${ui.exportFrom}-to-${ui.exportTo}.csv`, N.toCsv(N.foodRows(state, ui.exportFrom, ui.exportTo)), 'text/csv'); }
};

document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('.tabs button');
  if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = ev.target.closest('[data-act]');
  if (b && actions[b.dataset.act] && !b.disabled) actions[b.dataset.act](b);
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  const text = form.elements.q.value;
  if (form.dataset.form === 'add') addFromText(text);
  if (form.dataset.form === 'ingredient') sheetLookup(text, (rec, items) => { rec.items.push(...items); });
  if (form.dataset.form === 'swap') {
    const i = Number(form.dataset.i);
    sheetLookup(text, (rec, items) => { rec.items.splice(i, 1, ...items); });
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const d = el.dataset;
  if (d.set) {
    if (d.set === 'lookupKey') { ls.set(LS.key, el.value.trim()); setSettings({ lookupKey: el.value.trim() }); return; }
    const v = Number(el.value);
    if (v > 0) setSettings({ [d.set]: v }); else el.value = g(state.settings[d.set]);
    return;
  }
  if (d.track) {
    setSettings({ track: { ...state.settings.track, [d.track]: el.checked } });
    render();
    return;
  }
  if (d.exp) { ui[d.exp] = el.value; return; }
  if (d.day) {
    if (d.day === 'weight') setDay({ weight: Number(el.value) > 0 ? Number(el.value) : 0 });
    else if (d.day === 'doseNote') setDay({ doseNote: el.value.trim() });
    else if (d.day === 'effectsOther') {
      const cur = String(dayRec(ui.date).effects || '').split(',').map((x) => x.trim()).filter((x) => EFFECTS.includes(x));
      setDay({ effects: cur.concat(el.value.split(',').map((x) => x.trim()).filter(Boolean)).join(', ') });
    }
    return;
  }
  if (d.rec && sheetRec()) {
    const rec = { ...sheetRec(), [d.rec]: el.value.trim() || (d.rec === 'name' ? 'Go-to' : '') };
    put(ui.sheet.kind === 'entry' ? 'entries' : 'gotos', rec.id, rec);
    render();
    return;
  }
  if (d.item != null && sheetRec()) {
    const rec = clone(sheetRec());
    const i = Number(d.item);
    rec.items[i] = N.setItemTotal(rec.items[i], d.f, Number(el.value));
    // Remember the correction, so this food comes back right next time.
    const it = rec.items[i];
    const food = it.key && state.foods[it.key];
    if (food && !food.deleted) put('foods', it.key, { ...food, p1: it.p1, f1: it.f1, estimate: false, edited: true });
    saveSheetRec(rec);
  }
});

$('#sheet').addEventListener('close', () => { ui.sheet = null; document.body.appendChild($('#toast')); });
$('#sheet').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) closeSheet(); });   // tap outside
window.addEventListener('online', () => scheduleSync(500));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Coming back the next morning should show the new day, not yesterday.
  if (ui.lastSeen && ui.lastSeen !== today() && ui.date === ui.lastSeen) {
    ui.date = today();
    ui.meal = N.mealForHour(new Date().getHours());
    render();
  }
  ui.lastSeen = today();
  scheduleSync(800);
});

// -------------------------------------------------------------------- boot
(async function boot() {
  const hashed = consumeHash();
  await loadLocal();
  if (hashed === 'key') { setSettings({ lookupKey: ls.get(LS.key) }); ui.tab = 'settings'; }
  ui.lastSeen = today();
  applyTheme();
  render();
  if (hashed === 'key') toast('Lookup passphrase saved on this device.');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // Renew a lapsed Google sign-in quietly, but only at launch so it never interrupts logging.
  const lastTry = Number(ls.get(LS.silentTry)) || 0;
  if (clientId() && ls.get(LS.connected) && !token() && navigator.onLine && Date.now() - lastTry > 10 * 60 * 1000) { startAuth(true); return; }
  sync();
})();
