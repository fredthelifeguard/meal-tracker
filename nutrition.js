// Nutrition math and other pure logic. No DOM, no network, so it can be tested
// on its own (open tests.html).

export const MEALS = ['breakfast', 'lunch', 'supper'];          // the 40g target applies to these
export const SLOTS = ['breakfast', 'lunch', 'supper', 'snack']; // everything counts toward fiber
export const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', supper: 'Supper', snack: 'Snack' };
export const COLLECTIONS = ['entries', 'gotos', 'foods', 'days'];

export const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const pos = (n) => (Number(n) > 0 ? Number(n) : 0);

// An item is one food: qty units, each with p1 g protein and f1 g fiber.
export function itemTotals(item, portion = 1) {
  if (!item || item.skip) return { protein: 0, fiber: 0, kcal: 0 };
  const q = pos(item.qty) * pos(portion);
  return { protein: q * pos(item.p1), fiber: q * pos(item.f1), kcal: q * pos(item.k1) };
}

// An entry is one logged thing: a list of items times a portion (0.5, 1, 2...).
export function entryTotals(entry) {
  const t = { protein: 0, fiber: 0, kcal: 0 };
  if (!entry || entry.deleted) return t;
  const portion = entry.portion == null ? 1 : entry.portion;
  for (const it of entry.items || []) {
    const x = itemTotals(it, portion);
    t.protein += x.protein; t.fiber += x.fiber; t.kcal += x.kcal;
  }
  return t;
}

// Protein per slot and fiber for the whole day (snacks included).
export function dayTotals(entries, date) {
  const out = { fiber: 0, protein: { breakfast: 0, lunch: 0, supper: 0, snack: 0 }, count: 0 };
  for (const e of Array.isArray(entries) ? entries : Object.values(entries || {})) {
    if (!e || e.deleted || e.date !== date) continue;
    const t = entryTotals(e);
    const slot = SLOTS.includes(e.meal) ? e.meal : 'snack';
    out.protein[slot] += t.protein;
    out.fiber += t.fiber;
    out.count += 1;
  }
  for (const s of SLOTS) out.protein[s] = r1(out.protein[s]);
  out.fiber = r1(out.fiber);
  return out;
}

// 0..1 share of a goal, for drawing. Going over a goal is just "full".
export function progress(value, goal) {
  if (!(Number(goal) > 0)) return 0;
  return Math.max(0, Math.min(1, pos(value) / goal));
}

// Hand correction: the person types the total for the amount shown.
export function setItemTotal(item, field, total) {
  const q = pos(item.qty) || 1;
  const key = field === 'protein' ? 'p1' : 'f1';
  return { ...item, [key]: pos(total) / q, estimate: false, edited: true };
}

export function mealForHour(hour) {
  if (hour < 10.5) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'supper';
}

export function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
export function fromYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// ----------------------------------------------------------- text handling
const fold = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9%./ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const singular = (w) => (w.length > 3 && /[^s]s$/.test(w) ? w.replace(/(ch|sh|x|ss)es$/, '$1').replace(/ies$/, 'y').replace(/s$/, '') : w);

export function textKey(text) { return fold(text); }
export function foodKey(name, unit) { return fold(name).split(' ').map(singular).join(' ') + '|' + singular(fold(unit || 'serving')); }

const WORD_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2
};
const UNITS = ['cup', 'tbsp', 'tablespoon', 'tsp', 'teaspoon', 'oz', 'ounce', 'g', 'gram', 'lb', 'pound', 'ml',
  'slice', 'piece', 'scoop', 'can', 'bottle', 'bar', 'packet', 'serving', 'handful', 'bowl', 'glass', 'stick'];

function readNumber(tok) {
  if (tok in WORD_NUM) return WORD_NUM[tok];
  let m = /^(\d+)\/(\d+)$/.exec(tok);
  if (m && Number(m[2])) return Number(m[1]) / Number(m[2]);
  m = /^\d*\.?\d+$/.exec(tok);
  return m ? Number(tok) : null;
}

// Fallback parser for when the lookup service can't be reached:
// "2 eggs and 1/2 cup oatmeal" -> [{qty:2, unit:'egg', name:'egg'}, {qty:0.5, unit:'cup', name:'oatmeal'}]
export function parseQuick(text) {
  const parts = String(text || '').split(/\s*(?:,|\+|&|\band\b|\bwith\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    let toks = fold(part).split(' ').filter(Boolean);
    let qty = 1;
    let m = toks[0] && /^(\d*\.?\d+)([a-z]+)$/.exec(toks[0]);       // "30g"
    if (m) toks.splice(0, 1, m[1], m[2]);
    const n = toks.length ? readNumber(toks[0]) : null;
    if (n != null && toks.length > 1) {
      qty = n; toks = toks.slice(1);
      const n2 = readNumber(toks[0]);                                // "1 1/2 cups", "a half cup"
      if (n2 != null && n2 < 1 && toks.length > 1) { qty = toks[0] === 'half' && qty === 1 ? 0.5 : qty + n2; toks = toks.slice(1); }
      if (toks[0] === 'a' && toks.length > 1) toks = toks.slice(1);  // "half a cup"
    }
    let unit = '';
    const u = toks.length > 1 ? singular(toks[0]) : '';
    if (UNITS.includes(u)) { unit = u; toks = toks.slice(1); if (toks[0] === 'of' && toks.length > 1) toks = toks.slice(1); }
    const name = toks.join(' ');
    if (!name) continue;
    out.push({ name, brand: '', qty: qty > 0 ? qty : 1, unit: unit || singular(toks[toks.length - 1]), packaged: false, search: name });
  }
  return out;
}

export function fmtQty(q) {
  const n = Number(q) || 0;
  const whole = Math.floor(n);
  const frac = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round((n - whole) * 100) / 100];
  if (frac) return (whole ? whole : '') + frac;
  return String(r1(n));
}
export function fmtAmount(item) {
  const unit = String(item.unit || '').trim();
  return fmtQty(item.qty) + (unit && unit !== 'serving' && unit !== 'each' ? ' ' + unit : unit === 'serving' ? ' serving' : '');
}

// ------------------------------------------------------------------ go-tos
const cleanItem = (it) => {
  const { skip, ...rest } = it;
  return { ...rest };
};
// Turn logged entries (e.g. everything at one meal) into the ingredients of a go-to.
// Portions are folded into the amounts; left-out ingredients are dropped.
export function gotoItemsFrom(entries) {
  const items = [];
  for (const e of entries) {
    if (!e || e.deleted) continue;
    const portion = e.portion == null ? 1 : e.portion;
    for (const it of e.items || []) {
      if (it.skip) continue;
      items.push({ ...cleanItem(it), qty: r1(pos(it.qty) * portion) || pos(it.qty) * portion });
    }
  }
  return items;
}

// -------------------------------------------------------------------- sync
// Last write wins per record, so changes made on the phone and the PC both survive.
// Deleted records stay behind as { deleted: true, t } so the deletion syncs too.
export function mergeStates(local, remote) {
  const out = { version: 1, settings: local.settings };
  let localChanged = false;
  let remoteStale = !remote;
  const rs = remote && remote.settings;
  const ls = local.settings || {};
  if (rs && (Number(rs.t) || 0) > (Number(ls.t) || 0)) { out.settings = rs; localChanged = true; }
  else if (!rs || (Number(ls.t) || 0) > (Number(rs.t) || 0)) remoteStale = true;
  for (const c of COLLECTIONS) {
    const a = (local && local[c]) || {};
    const b = (remote && remote[c]) || {};
    out[c] = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[k]; const y = b[k];
      const tx = x ? Number(x.t) || 0 : -1;
      const ty = y ? Number(y.t) || 0 : -1;
      if (ty > tx) { out[c][k] = y; localChanged = true; }
      else { out[c][k] = x; if (tx > ty) remoteStale = true; }
    }
  }
  return { merged: out, localChanged, remoteStale };
}

// ------------------------------------------------------------------- water
// Water is kept in milliliters. Days recorded before the switch counted 8 oz glasses (237 mL each).
export function waterMl(day) {
  if (!day) return 0;
  if (day.waterMl != null) return pos(day.waterMl);
  return Math.round(pos(day.water) * 237);
}
// 1500 -> "1.5", 250 -> "0.25", 2000 -> "2"
export function fmtLiters(ml) { return String(Math.round(pos(ml) / 10) / 100); }

// ------------------------------------------------------------------ export
export function inRange(date, from, to) { return (!from || date >= from) && (!to || date <= to); }

export function foodRows(state, from, to) {
  const rows = [['Date', 'Meal', 'Time', 'Logged as', 'Food', 'Amount', 'Protein (g)', 'Fiber (g)', 'Calories', 'Source', 'Estimate', 'Note']];
  const list = Object.values(state.entries || {}).filter((e) => !e.deleted && inRange(e.date, from, to))
    .sort((a, b) => (a.date + SLOTS.indexOf(a.meal) + (a.time || '')).localeCompare(b.date + SLOTS.indexOf(b.meal) + (b.time || '')));
  for (const e of list) {
    const portion = e.portion == null ? 1 : e.portion;
    for (const it of e.items || []) {
      if (it.skip) continue;
      const t = itemTotals(it, portion);
      rows.push([e.date, SLOT_LABEL[e.meal] || e.meal, e.time || '', e.name || '', it.name,
        fmtAmount({ ...it, qty: pos(it.qty) * portion }), r1(t.protein), r1(t.fiber), Math.round(t.kcal),
        it.source || '', it.estimate ? 'yes' : '', e.note || '']);
    }
  }
  return rows;
}

export function dailyRows(state, from, to) {
  const rows = [['Date', 'Breakfast protein (g)', 'Lunch protein (g)', 'Supper protein (g)', 'Snack protein (g)',
    'Fiber (g)', 'Water (L)', 'Weight', 'Dose day', 'Side effects']];
  const dates = new Set();
  for (const e of Object.values(state.entries || {})) if (!e.deleted && inRange(e.date, from, to)) dates.add(e.date);
  for (const [d, v] of Object.entries(state.days || {})) {
    if (inRange(d, from, to) && (waterMl(v) || v.weight || v.dose || v.effects)) dates.add(d);
  }
  for (const d of [...dates].sort()) {
    const t = dayTotals(state.entries, d);
    const day = (state.days || {})[d] || {};
    rows.push([d, t.protein.breakfast, t.protein.lunch, t.protein.supper, t.protein.snack, t.fiber,
      waterMl(day) ? fmtLiters(waterMl(day)) : '', day.weight || '', day.dose ? 'yes' + (day.doseNote ? ' (' + day.doseNote + ')' : '') : '', day.effects || '']);
  }
  return rows;
}

// One block of text for pasting into a chat: the goals, then both tables as CSV.
export function exportText(state, from, to) {
  const s = state.settings || {};
  return [
    `Meal tracker export, ${from} to ${to}`,
    `Goals: ${r1(s.proteinGoal)} g protein per meal (breakfast, lunch, supper), ${r1(s.fiberGoal)} g fiber per day`,
    '',
    'Daily summary (CSV)',
    toCsv(dailyRows(state, from, to)).trim(),
    '',
    'Food log (CSV)',
    toCsv(foodRows(state, from, to)).trim(),
    ''
  ].join('\n');
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
