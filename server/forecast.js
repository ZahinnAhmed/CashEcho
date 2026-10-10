// Turns the owner's own recent daily results into a range of possible futures.
//
// The plain forecast in routes/wall.js carries one average forward. This module instead replays
// the last ~60 days many times in random order ("bootstrap"): each simulated day picks a real
// past day of the same weekday (a cart's Saturday looks different from its Tuesday), the
// scheduled loan payments come off on their due dates, and we record where cash ends up.
// From the thousands of simulated paths we report a likely range and the chance cash goes
// below zero. Nothing here predicts prices or markets; it only reshuffles what the owner
// actually did.

const PATHS = 2000;
const MIN_HISTORY_DAYS = 14; // days with logged activity needed to trust a day-by-day range
const MIN_SPARSE_DAYS = 4; // a week-by-week range needs at least this many logged days...
const MIN_SPARSE_SPAN = 28; // ...spread over at least this many days

// Small seeded random generator, so the same ledger gives the same numbers on every refresh
// (the screen and the spoken alert must agree).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const weekdayOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();

function percentile(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * history   [{ date: 'YYYY-MM-DD', net: number }]  one entry per day of the last 60 days
 *           (days with no activity are 0); daysWithActivity counts the non-empty ones
 * future    [{ date: 'YYYY-MM-DD', payment: number }]  one entry per forecast day
 * Owners who log every day get a day-by-day replay (by weekday). Owners who log in bursts, say once
 * a week, have lumpy days, so for them the replay works in whole weeks instead: each simulated week
 * is a real past week, spread evenly across its days.
 * Returns null when there is too little history, otherwise
 *   { weeks: [{ p10, p90, shortfall_prob }], shortfall_probability, paths, history_days }
 */
function simulate({ history, daysWithActivity, future, startingCash, seedKey }) {
  // How the ledger is kept: most days logged (daily) or in bursts (weekly)
  const logged = history.map((d, i) => (d.logged ? i : -1)).filter((i) => i >= 0);
  const span = logged.length ? logged[logged.length - 1] - logged[0] + 1 : 0;
  const daily = daysWithActivity >= MIN_HISTORY_DAYS && daysWithActivity / history.length >= 0.6;
  const weekly = !daily && daysWithActivity >= MIN_SPARSE_DAYS && history.length >= MIN_SPARSE_SPAN;
  if (!daily && !weekly) return null;
  void span;

  // One pool of past daily results per weekday
  const pools = Array.from({ length: 7 }, () => []);
  for (const day of history) pools[weekdayOf(day.date)].push(day.net);
  // A weekday with no samples borrows from all days
  const all = history.map((d) => d.net);
  for (let w = 0; w < 7; w++) if (!pools[w].length) pools[w] = all;

  // Same seedKey -> same random draws, so a what-if run differs from the base run only because of
  // the change being tested (not because of luck)
  const rand = mulberry32(hashString(seedKey));
  // Weekly mode: every 7-day window of the history is one possible "week"
  const weekSums = [];
  if (weekly) for (let i = 0; i + 7 <= all.length; i++) weekSums.push(all.slice(i, i + 7).reduce((a, b) => a + b, 0));
  const weekdays = future.map((d) => weekdayOf(d.date));
  const weekCount = Math.ceil(future.length / 7);
  const endOfWeek = Array.from({ length: weekCount }, () => new Float64Array(PATHS));
  const hitByWeek = new Uint32Array(weekCount); // paths that were below zero at some point by week w

  for (let p = 0; p < PATHS; p++) {
    let cash = startingCash;
    let hit = false;
    let weekPerDay = 0;
    for (let i = 0; i < future.length; i++) {
      if (weekly) {
        if (i % 7 === 0) weekPerDay = weekSums[Math.floor(rand() * weekSums.length)] / 7;
        cash += weekPerDay - future[i].payment;
      } else {
        const pool = pools[weekdays[i]];
        cash += pool[Math.floor(rand() * pool.length)] - future[i].payment;
      }
      if (cash < 0) hit = true;
      const isWeekEnd = i % 7 === 6 || i === future.length - 1;
      if (isWeekEnd) {
        const w = Math.floor(i / 7);
        endOfWeek[w][p] = cash;
        if (hit) hitByWeek[w]++;
      }
    }
  }

  const weeks = endOfWeek.map((values, w) => {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return {
      p10: percentile(sorted, 0.1),
      p90: percentile(sorted, 0.9),
      shortfall_prob: hitByWeek[w] / PATHS,
    };
  });

  return {
    weeks,
    shortfall_probability: weeks[weekCount - 1].shortfall_prob,
    paths: PATHS,
    history_days: daysWithActivity,
    mode: weekly ? 'weekly' : 'daily',
  };
}

module.exports = { simulate, MIN_HISTORY_DAYS, MIN_SPARSE_DAYS, MIN_SPARSE_SPAN };
