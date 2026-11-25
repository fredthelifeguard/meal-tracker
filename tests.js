// Tests for the nutrition math. Open tests.html in a browser to run them.
import * as N from './nutrition.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b}, got ${a}`);
}
const near = (a, b, label = '') => { if (Math.abs(a - b) > 1e-9) throw new Error(`${label} expected ${b}, got ${a}`); };

const biscuit = { name: 'sausage biscuit', qty: 2, unit: 'biscuit', p1: 5, f1: 0.5, k1: 170 };
const chia = { name: 'chia seeds', qty: 2, unit: 'tbsp', p1: 2, f1: 4.1, k1: 60 };
const yogurt = { name: 'greek yogurt', qty: 1, unit: 'cup', p1: 23, f1: 0, k1: 150 };

test('item totals multiply amount by per-unit values', () => {
  const t = N.itemTotals(biscuit);
  near(t.protein, 10); near(t.fiber, 1); near(t.kcal, 340);
});
test('item totals scale with portion', () => {
  near(N.itemTotals(biscuit, 0.5).protein, 5);
  near(N.itemTotals(biscuit, 2).fiber, 2);
});
test('a left-out ingredient counts for nothing', () => {
  eq(N.itemTotals({ ...chia, skip: true }), { protein: 0, fiber: 0, kcal: 0, grains: 0 });
});
test('missing or bad numbers count as zero, never NaN', () => {
  eq(N.itemTotals({ qty: 'x', p1: undefined, f1: null }), { protein: 0, fiber: 0, kcal: 0, grains: 0 });
  eq(N.itemTotals(null), { protein: 0, fiber: 0, kcal: 0, grains: 0 });
  near(N.itemTotals({ qty: 1, p1: -4, f1: 2 }).protein, 0);
});
test('entry totals sum ingredients', () => {
  const t = N.entryTotals({ items: [yogurt, chia] });
  near(t.protein, 27); near(t.fiber, 8.2);
});
test('entry totals respect half and double portions', () => {
  near(N.entryTotals({ items: [yogurt, chia], portion: 0.5 }).protein, 13.5);
  near(N.entryTotals({ items: [yogurt, chia], portion: 2 }).fiber, 16.4);
});
test('entry totals skip left-out ingredients and deleted entries', () => {
  near(N.entryTotals({ items: [yogurt, { ...chia, skip: true }] }).fiber, 0);
  near(N.entryTotals({ items: [yogurt], deleted: true }).protein, 0);
});

const day = '2026-11-12';
const entries = {
  a: { date: day, meal: 'breakfast', items: [yogurt, chia] },                 // 27 p, 8.2 f
  b: { date: day, meal: 'breakfast', items: [biscuit] },                      // 10 p, 1 f
  c: { date: day, meal: 'lunch', items: [yogurt], portion: 2 },               // 46 p
  d: { date: day, meal: 'snack', items: [{ qty: 1, p1: 3, f1: 6 }] },         // 3 p, 6 f
  e: { date: '2026-11-11', meal: 'supper', items: [yogurt] },                 // another day
  f: { date: day, meal: 'supper', items: [yogurt], deleted: true }            // deleted
};
test('day totals give protein per meal', () => {
  const t = N.dayTotals(entries, day);
  eq(t.protein, { breakfast: 37, lunch: 46, supper: 0, snack: 3 });
});
test('fiber is a running total for the day, snacks included', () => {
  eq(N.dayTotals(entries, day).fiber, 15.2);
});
test('snack protein stays out of the three meals', () => {
  const t = N.dayTotals(entries, day);
  eq(t.protein.breakfast + t.protein.lunch + t.protein.supper, 83);
});
test('other days and deleted entries are ignored', () => {
  eq(N.dayTotals(entries, day).count, 4);
  eq(N.dayTotals(entries, '2026-11-11').protein.supper, 23);
  eq(N.dayTotals(entries, '2026-01-01').fiber, 0);
});
test('day totals accept a list or a map, and an unknown meal counts as a snack', () => {
  eq(N.dayTotals([{ date: day, meal: 'brunch', items: [yogurt] }], day).protein.snack, 23);
  eq(N.dayTotals(undefined, day).fiber, 0);
});
test('totals are rounded to one decimal without drift', () => {
  const many = Array.from({ length: 10 }, () => ({ date: day, meal: 'lunch', items: [{ qty: 1, p1: 0.1, f1: 0.1 }] }));
  eq(N.dayTotals(many, day).protein.lunch, 1);
  eq(N.dayTotals(many, day).fiber, 1);
});

test('calories are a running total for the day, snacks included', () => {
  eq(N.dayTotals(entries, day).kcal, 910);                // 270 + 340 + 300, and a snack with no calories
  eq(N.dayTotals(entries, '2026-11-11').kcal, 150);
  eq(N.dayTotals(entries, '2026-01-01').kcal, 0);
  eq(N.dayTotals([{ date: day, meal: 'snack', items: [{ qty: 3, k1: 33.4 }] }], day).kcal, 100, 'whole calories');
});

const toast = { name: 'whole wheat toast', qty: 2, unit: 'slice', p1: 4, f1: 2, k1: 80, w1: 1 };
const oats = { name: 'rolled oats', qty: 40, unit: 'g', p1: 0.13, f1: 0.1, k1: 3.8, w1: 0.0625 };
test('whole grains multiply by amount and portion like everything else', () => {
  near(N.itemTotals(toast).grains, 2);
  near(N.itemTotals(toast, 0.5).grains, 1);
  near(N.itemTotals(oats).grains, 2.5);
  near(N.itemTotals({ ...toast, skip: true }).grains, 0);
  near(N.entryTotals({ items: [toast, yogurt], portion: 2 }).grains, 4);
});
test('a food with no whole-grain number counts as none', () => {
  near(N.itemTotals(yogurt).grains, 0);
  near(N.itemTotals({ ...toast, w1: -1 }).grains, 0);
});
test('things logged before whole grains were tracked borrow the number from the saved food', () => {
  const foods = { 'f:toast|slice': { name: 'toast', w1: 1 }, 'f:gone|slice': { w1: 1, deleted: true } };
  const old = { name: 'toast', key: 'f:toast|slice', qty: 2, p1: 4, f1: 2 };
  near(N.itemTotals(old, 1, foods).grains, 2);
  near(N.itemTotals(old).grains, 0, 'no saved foods');
  near(N.itemTotals({ ...old, key: 'f:gone|slice' }, 1, foods).grains, 0, 'deleted food');
  near(N.itemTotals({ ...old, w1: 0 }, 1, foods).grains, 0, 'its own number wins, even zero');
  near(N.entryTotals({ items: [old] }, foods).grains, 2);
  eq(N.dayTotals([{ date: day, meal: 'breakfast', items: [old] }], day, foods).grains, 2);
});
test('whole grains for the day are counted in quarters and reach the goal on what is shown', () => {
  const at = (w1) => N.dayTotals([{ date: day, meal: 'lunch', items: [{ qty: 1, w1 }] }], day).grains;
  eq(at(1.9), 2); eq(at(1.8), 1.75); eq(at(0.5), 0.5); eq(at(0), 0);
  const three = Array.from({ length: 3 }, () => ({ date: day, meal: 'snack', items: [{ qty: 1, w1: 0.667 }] }));
  eq(N.dayTotals(three, day).grains, 2);
  eq(N.dayTotals(entries, day).grains, 0);
  eq(N.fmtQty(1.25), '1¼'); eq(N.fmtQty(0), '0');
});

test('progress is the share of the goal, capped at full', () => {
  eq(N.progress(20, 40), 0.5);
  eq(N.progress(55, 40), 1);
  eq(N.progress(0, 40), 0);
  eq(N.progress(10, 0), 0);
  eq(N.progress(-5, 40), 0);
});
test('progress follows an edited goal', () => {
  eq(N.progress(30, 30), 1);
  eq(N.progress(17.5, 35), 0.5);
});

test('correcting a total by hand rewrites the per-unit value', () => {
  const fixed = N.setItemTotal(biscuit, 'protein', 12);
  near(fixed.p1, 6); near(N.itemTotals(fixed).protein, 12);
  eq(fixed.estimate, false); eq(fixed.edited, true);
  near(N.setItemTotal(chia, 'fiber', 10).f1, 5);
  near(biscuit.p1, 5, 'original untouched');
});
test('calories and whole grains can be corrected by hand without touching the estimate tag', () => {
  const guess = { ...biscuit, estimate: true };
  const cals = N.setItemTotal(guess, 'kcal', 400);
  near(cals.k1, 200); near(N.itemTotals(cals).kcal, 400);
  eq([cals.estimate, cals.edited], [true, true]);
  const grains = N.setItemTotal(guess, 'grains', 1);
  near(grains.w1, 0.5); near(N.itemTotals(grains).grains, 1);
  eq(grains.estimate, true);
  near(N.setItemTotal(guess, 'protein', 12).k1, 170, 'other numbers untouched');
});

test('meal is guessed from the time of day', () => {
  eq(N.mealForHour(7), 'breakfast'); eq(N.mealForHour(12), 'lunch'); eq(N.mealForHour(18.5), 'supper');
});
test('dates move by whole days across months', () => {
  eq(N.addDays('2026-11-30', 1), '2026-12-01');
  eq(N.addDays('2026-03-01', -1), '2026-02-28');
  eq(N.ymd(N.fromYmd('2026-11-12')), '2026-11-12');
});

test('quick parser reads amounts and units', () => {
  eq(N.parseQuick('2 eggs').map((i) => [i.qty, i.unit, i.name]), [[2, 'egg', 'eggs']]);
  eq(N.parseQuick('1/2 cup oatmeal').map((i) => [i.qty, i.unit, i.name]), [[0.5, 'cup', 'oatmeal']]);
  eq(N.parseQuick('two tbsp of chia seeds').map((i) => [i.qty, i.unit, i.name]), [[2, 'tbsp', 'chia seeds']]);
  eq(N.parseQuick('1 1/2 cups spinach')[0].qty, 1.5);
  eq(N.parseQuick('half a cup of yogurt').map((i) => [i.qty, i.unit, i.name]), [[0.5, 'cup', 'yogurt']]);
  eq(N.parseQuick('30g almonds').map((i) => [i.qty, i.unit, i.name]), [[30, 'g', 'almonds']]);
});
test('quick parser splits a list and defaults to one', () => {
  eq(N.parseQuick('banana, 2 eggs and toast').map((i) => i.qty), [1, 2, 1]);
  eq(N.parseQuick('').length, 0);
});
test('the same food gets the same cache key however it is typed', () => {
  eq(N.foodKey('Chia Seeds', 'tbsp'), N.foodKey('chia seed', 'Tbsp'));
  eq(N.textKey('  Two  Eggs! '), N.textKey('two eggs'));
});
test('amounts print as fractions where natural', () => {
  eq(N.fmtQty(0.5), '½'); eq(N.fmtQty(1.5), '1½'); eq(N.fmtQty(2), '2'); eq(N.fmtQty(0.3), '0.3');
  eq(N.fmtAmount({ qty: 2, unit: 'biscuit' }), '2 biscuit');
});

test('a go-to made from logged entries folds in the portion and drops left-out items', () => {
  const items = N.gotoItemsFrom([
    { items: [yogurt, { ...chia, skip: true }], portion: 2 },
    { items: [biscuit] },
    { items: [chia], deleted: true }
  ]);
  eq(items.map((i) => [i.name, i.qty]), [['greek yogurt', 2], ['sausage biscuit', 2]]);
  eq('skip' in items[0], false);
  near(N.entryTotals({ items }).protein, 56);
});

test('merge keeps the newest copy of each record from either side', () => {
  const local = { settings: { proteinGoal: 40, t: 5 }, entries: { a: { t: 2, v: 'local' }, b: { t: 1 } }, gotos: {}, foods: {}, days: {} };
  const remote = { settings: { proteinGoal: 45, t: 9 }, entries: { a: { t: 1, v: 'remote' }, c: { t: 3 } }, gotos: { g: { t: 1 } } };
  const { merged, localChanged, remoteStale } = N.mergeStates(local, remote);
  eq(merged.entries.a.v, 'local'); eq(Object.keys(merged.entries).sort(), ['a', 'b', 'c']);
  eq(merged.settings.proteinGoal, 45); eq(!!merged.gotos.g, true);
  eq([localChanged, remoteStale], [true, true]);
});
test('merge with nothing remote marks the remote as needing an upload', () => {
  const local = { settings: { t: 1 }, entries: {}, gotos: {}, foods: {}, days: {} };
  eq(N.mergeStates(local, null).remoteStale, true);
  const same = N.mergeStates(local, JSON.parse(JSON.stringify(local)));
  eq([same.localChanged, same.remoteStale], [false, false]);
});
test('a deletion wins when it is newer', () => {
  const local = { settings: { t: 1 }, entries: { a: { t: 5, deleted: true } }, gotos: {}, foods: {}, days: {} };
  const remote = { settings: { t: 1 }, entries: { a: { t: 2, items: [yogurt] } } };
  eq(N.mergeStates(local, remote).merged.entries.a.deleted, true);
});

test('water is counted in milliliters and shown in liters', () => {
  eq(N.waterMl({ waterMl: 1500 }), 1500);
  eq(N.waterMl({}), 0); eq(N.waterMl(undefined), 0);
  eq(N.fmtLiters(1500), '1.5'); eq(N.fmtLiters(250), '0.25'); eq(N.fmtLiters(2000), '2'); eq(N.fmtLiters(0), '0');
  eq(N.fmtLiters(500 + 1000 + 500), '2');
});
test('days recorded as 8 oz glasses convert to milliliters', () => {
  eq(N.waterMl({ water: 4 }), 948);
  eq(N.waterMl({ water: 4, waterMl: 500 }), 500);
});

const state = { entries, days: { [day]: { waterMl: 1500, weight: 200, dose: true, effects: 'mild nausea' }, '2026-10-01': { waterMl: 750 } } };
test('daily export has one row per day in range with the goal numbers', () => {
  const rows = N.dailyRows(state, '2026-11-11', '2026-11-12');
  eq(rows.length, 3);
  eq(rows[2].slice(0, 6), [day, 37, 46, 0, 3, 15.2]);
  eq(rows[0].slice(5, 9), ['Fiber (g)', 'Calories', 'Whole grains (servings)', 'Water (L)']);
  eq(rows[2].slice(6), [910, 0, '1.5', 200, 'yes', 'mild nausea']);
});
test('exports carry calories and whole grains', () => {
  const s = {
    entries: { a: { date: day, meal: 'breakfast', items: [toast, { name: 'old oatmeal', key: 'f:oat|cup', qty: 1, unit: 'cup', k1: 150 }], portion: 0.5 } },
    foods: { 'f:oat|cup': { name: 'oatmeal', w1: 2 } }
  };
  eq(N.dailyRows(s, day, day)[1].slice(6, 8), [155, 2]);
  const food = N.foodRows(s, day, day);
  eq(food[0].slice(8, 11), ['Calories', 'Whole grains (servings)', 'Source']);
  eq(food.slice(1).map((r) => [r[4], r[8], r[9]]), [['whole wheat toast', 80, 1], ['old oatmeal', 75, 1]]);
});
test('food export lists each food with portion applied, inside the range only', () => {
  const rows = N.foodRows(state, day, day);
  eq(rows.length, 1 + 5);
  const lunch = rows.find((r) => r[1] === 'Lunch');
  eq([lunch[5], lunch[6]], ['2 cup', 46]);
});
test('the text for pasting into a chat carries the goals and both tables for the range', () => {
  const text = N.exportText({ ...state, settings: { proteinGoal: 40, fiberGoal: 35 } }, day, day);
  const lines = text.split(/\r?\n/);
  eq(lines[0], `Meal tracker export, ${day} to ${day}`);
  eq(lines[1].includes('40 g protein per meal') && lines[1].includes('35 g fiber per day'), true);
  eq(lines.filter((l) => l.startsWith(day + ',')).length, 1 + 5, 'one daily row plus five foods');
  eq(text.includes('2026-11-11'), false, 'nothing outside the range');
  eq(lines[1].includes('calories'), false, 'no calorie goal, no mention');
  const full = N.exportText({ ...state, settings: { proteinGoal: 40, fiberGoal: 35, calorieGoal: 1600, grainGoal: 2 } }, day, day);
  eq(full.split(/\r?\n/)[1].endsWith('1600 calories per day, 2 servings of whole grains per day'), true);
});
test('CSV quotes commas, quotes and line breaks', () => {
  eq(N.toCsv([['a', 'b,c', 'say "hi"', 'x\ny']]), 'a,"b,c","say ""hi""","x\ny"\r\n');
});

// ---- report
const failed = results.filter((r) => !r.ok);
document.title = failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`;
document.getElementById('summary').textContent = failed.length
  ? `${failed.length} of ${results.length} tests failed`
  : `All ${results.length} tests passed`;
document.getElementById('list').innerHTML = results.map((r) =>
  `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'pass' : 'FAIL'}: ${r.name}${r.msg ? '<br><code>' + r.msg.replace(/</g, '&lt;') + '</code>' : ''}</li>`).join('');
window.TEST_RESULTS = { total: results.length, failed: failed.map((f) => f.name + ': ' + f.msg) };
