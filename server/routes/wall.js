const express = require('express');
const pool = require('../db');
const { simulate, MIN_HISTORY_DAYS, MIN_SPARSE_DAYS, MIN_SPARSE_SPAN } = require('../forecast');

const router = express.Router();

const HORIZON_DAYS = 90;

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};
const prettyDate = (key) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// What one payment of a loan costs per month, whatever its frequency (for the coverage ratio)
function monthlyEquivalent(debt) {
  const amount = Number(debt.monthly_payment);
  if (debt.payment_frequency === 'weekly') return (amount * 52) / 12;
  if (debt.payment_frequency === 'daily') return (amount * 260) / 12; // business days only
  return amount;
}

// Upcoming payments in the next 90 days, worked out from each loan's terms.
//   monthly: on payment_day (the last day of short months)
//   weekly:  every payment_weekday
//   daily:   every business day (Monday to Friday), like many merchant cash advances
//   plus the balloon payment, if there is one
function schedulePayments(debts, start) {
  const startKey = dateKey(start);
  const endKey = dateKey(addDays(start, HORIZON_DAYS - 1));
  const rows = [];

  for (const debt of debts) {
    const endDate = dateKey(debt.end_date);
    const amount = Number(debt.monthly_payment);
    const frequency = debt.payment_frequency || 'monthly';

    if (amount > 0 && frequency === 'monthly') {
      for (let offset = 0; offset < 4; offset++) {
        const lastDay = new Date(start.getFullYear(), start.getMonth() + offset + 1, 0).getDate();
        const due = new Date(start.getFullYear(), start.getMonth() + offset, Math.min(debt.payment_day, lastDay));
        const key = dateKey(due);
        if (key >= startKey && key <= endKey && key <= endDate) {
          rows.push({ debt_id: debt.id, lender: debt.lender, due_date: key, amount, kind: 'monthly' });
        }
      }
    } else if (amount > 0) {
      for (let i = 0; i < HORIZON_DAYS; i++) {
        const day = addDays(start, i);
        const key = dateKey(day);
        if (key > endDate) break;
        const due = frequency === 'daily' ? day.getDay() >= 1 && day.getDay() <= 5 : day.getDay() === debt.payment_weekday;
        if (due) rows.push({ debt_id: debt.id, lender: debt.lender, due_date: key, amount, kind: frequency });
      }
    }

    const balloonAmount = Number(debt.balloon_amount);
    const balloonDate = debt.balloon_date && dateKey(debt.balloon_date);
    if (balloonAmount > 0 && balloonDate >= startKey && balloonDate <= endKey && balloonDate <= endDate) {
      rows.push({ debt_id: debt.id, lender: debt.lender, due_date: balloonDate, amount: balloonAmount, kind: 'balloon' });
    }
  }
  return rows.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// For display: a daily loan would be about 60 rows in 90 days, so it is shown as one line per
// week ("5 payments, $190"). The forecast itself still uses every single payment.
function collapseDaily(payments) {
  const out = [];
  const weeks = new Map();
  for (const p of payments) {
    if (p.kind !== 'daily') {
      out.push(p);
      continue;
    }
    const d = new Date(`${p.due_date}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to that week's Monday
    const key = `${p.debt_id}|${dateKey(d)}`;
    if (!weeks.has(key)) {
      const row = { ...p, count: 0, amount: 0 };
      weeks.set(key, row);
      out.push(row);
    }
    const row = weeks.get(key);
    row.count += 1;
    row.amount += p.amount;
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// Step 1: read everything one user's forecast is built from.
async function loadWallInputs(userId) {
  // Cash on hand = opening_cash (settings table, else STARTING_CASH from .env, else 0)
  // + all income - all expenses logged so far
  const [opening, net, recent, debtRows, dailyRows, lastEntry] = await Promise.all([
    pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'opening_cash'", [userId]),
    // Both sums read Tiger Data's daily_totals continuous aggregate (one row per day)
    // instead of scanning every transaction.
    pool.query(`SELECT COALESCE(SUM(income - expenses), 0) AS net FROM daily_totals WHERE user_id = $1`, [userId]),
    // Last 60 days. Loan payments are left out (net_excl_loans) because future loan payments
    // are subtracted separately.
    pool.query(
      `SELECT COALESCE(SUM(net_excl_loans), 0) AS net
       FROM daily_totals
       WHERE user_id = $1 AND day >= date_trunc('day', now()) - interval '59 days'`,
      [userId]
    ),
    pool.query('SELECT * FROM debts WHERE user_id = $1 ORDER BY id', [userId]),
    // Each of the last 60 days, for the range of possible outcomes (forecast.js)
    pool.query(
      `SELECT to_char(day AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, net_excl_loans AS net
       FROM daily_totals
       WHERE user_id = $1 AND day >= date_trunc('day', now()) - interval '59 days'`,
      [userId]
    ),
    pool.query(
      `SELECT to_char(MAX(day) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date FROM daily_totals WHERE user_id = $1`,
      [userId]
    ),
  ]);

  const openingCash = Number(opening.rows[0]?.value ?? process.env.STARTING_CASH ?? 0);
  const start = new Date();
  start.setHours(12, 0, 0, 0);

  const byDate = new Map(dailyRows.rows.map((r) => [r.date, Number(r.net)]));
  const history = [];
  for (let i = 59; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    history.push({ date: key, net: byDate.get(key) ?? 0, logged: byDate.has(key) });
  }
  // Average over the days since the first entry (at most 60). Dividing a new owner's first day
  // by 60 would make a $90 day look like $1.50 a day.
  const firstLogged = history.findIndex((d) => d.logged);
  const averageDays = firstLogged === -1 ? 60 : 60 - firstLogged;

  return {
    userId,
    start,
    startingCash: openingCash + Number(net.rows[0].net),
    averageDailyNet: Number(recent.rows[0].net) / averageDays,
    averageDays,
    debts: debtRows.rows,
    history,
    daysWithActivity: byDate.size,
    lastEntryDate: lastEntry.rows[0].date,
    // Fixed for a given ledger, so every what-if run uses the same random draws
    seedKey: `${userId}|${dateKey(start)}|${Math.round(history.reduce((n, d) => n + d.net, 0))}`,
  };
}

// Step 2: run the forecast. `changes` lets the solver ask "what if?":
//   extraCash         start with this much more in the bank
//   balloonShiftDays  push every balloon payment this many days later
//   dailyNetDelta     earn (or save) this much more every day
function forecast(inputs, changes = {}) {
  const { extraCash = 0, balloonShiftDays = 0, dailyNetDelta = 0 } = changes;
  const { start, history, userId } = inputs;
  const startingCash = inputs.startingCash + extraCash;
  const averageDailyNet = inputs.averageDailyNet + dailyNetDelta;

  const debts = inputs.debts.map((d) => {
    if (!balloonShiftDays || !(Number(d.balloon_amount) > 0) || !d.balloon_date) return d;
    const balloonDate = addDays(d.balloon_date, balloonShiftDays);
    return { ...d, balloon_date: balloonDate, end_date: balloonDate > d.end_date ? balloonDate : d.end_date };
  });
  const payments = schedulePayments(debts, start);

  const future = Array.from({ length: HORIZON_DAYS }, (_, i) => {
    const date = dateKey(addDays(start, i));
    return { date, payment: payments.filter((p) => p.due_date === date).reduce((n, p) => n + p.amount, 0) };
  });

  let cash = startingCash;
  let firstShortfall = null;
  const weeks = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const key = future[i].date;
    cash += averageDailyNet;

    for (const p of payments.filter((x) => x.due_date === key)) {
      cash -= p.amount;
      if (cash < 0 && !firstShortfall) firstShortfall = { ...p, shortfall: Math.abs(cash) };
    }

    const index = Math.floor(i / 7);
    if (!weeks[index]) {
      weeks[index] = { date: key, label: prettyDate(key), payments: 0, projected_cash: cash, min_cash: cash, shortfall: false };
    }
    const week = weeks[index];
    week.payments += future[i].payment;
    week.projected_cash = cash;
    week.min_cash = Math.min(week.min_cash, cash);
    week.shortfall = week.min_cash < 0;
  }

  // Range of possible outcomes: replay the last 60 days many times (see forecast.js)
  const uncertainty = simulate({
    history: history.map((d) => ({ ...d, net: d.net + dailyNetDelta })),
    daysWithActivity: inputs.daysWithActivity,
    future,
    startingCash,
    seedKey: inputs.seedKey,
  });

  if (uncertainty) {
    weeks.forEach((week, w) => {
      week.p10_cash = uncertainty.weeks[w].p10;
      week.p90_cash = uncertainty.weeks[w].p90;
      week.band = [uncertainty.weeks[w].p10, uncertainty.weeks[w].p90]; // for the chart's shaded range
      week.shortfall_prob = uncertainty.weeks[w].shortfall_prob;
    });
    if (firstShortfall) {
      const dayIndex = future.findIndex((d) => d.date === firstShortfall.due_date);
      firstShortfall.probability = uncertainty.weeks[Math.floor(dayIndex / 7)].shortfall_prob;
    }
  }

  // Debt coverage: how many times monthly operating cash (before loan payments) covers the
  // monthly loan payments. Lenders often look for 1.25 or higher.
  const todayKey = dateKey(start);
  const monthlyLoanPayments = debts
    .filter((d) => dateKey(d.end_date) >= todayKey)
    .reduce((n, d) => n + monthlyEquivalent(d), 0);
  const monthlyOperatingCash = averageDailyNet * 30;

  return {
    starting_cash: Math.round(startingCash * 100) / 100, // sums of decimals leave tails like .4400000000005
    average_daily_net: averageDailyNet,
    average_days: inputs.averageDays,
    // Under a week of entries the forecast is only a rough guide (the screen and alert say so)
    early_days: inputs.daysWithActivity > 0 && inputs.daysWithActivity < 7 ? inputs.daysWithActivity : null,
    coverage: {
      monthly_operating_cash: monthlyOperatingCash,
      monthly_loan_payments: monthlyLoanPayments,
      ratio: monthlyLoanPayments > 0 ? monthlyOperatingCash / monthlyLoanPayments : null,
    },
    weeks,
    payments: collapseDaily(payments),
    first_shortfall: firstShortfall,
    shortfall_probability: uncertainty ? uncertainty.shortfall_probability : null,
    uncertainty: uncertainty && { paths: uncertainty.paths, history_days: uncertainty.history_days, mode: uncertainty.mode },
    // When there is too little history for a likely range, say exactly what is needed (no guessing)
    history_needed: uncertainty
      ? null
      : {
          days_logged: inputs.daysWithActivity,
          daily_days: MIN_HISTORY_DAYS,
          weekly_days: MIN_SPARSE_DAYS,
          weekly_span: MIN_SPARSE_SPAN,
        },
    last_entry_date: inputs.lastEntryDate,
    days_since_last_entry: inputs.lastEntryDate
      ? Math.max(0, Math.round((new Date(dateKey(start) + 'T12:00:00') - new Date(inputs.lastEntryDate + 'T12:00:00')) / 86400000))
      : null,
  };
}

// Used by GET /api/wall, the spoken alert and the lender summary
async function computeWall(userId) {
  return forecast(await loadWallInputs(userId));
}

router.get('/', async (req, res) => {
  try {
    res.json(await computeWall(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.computeWall = computeWall;
module.exports.loadWallInputs = loadWallInputs;
module.exports.forecast = forecast;
module.exports.monthlyEquivalent = monthlyEquivalent;
