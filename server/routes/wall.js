const express = require('express');
const pool = require('../db');

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

// Upcoming payments in the next 90 days, worked out from each loan's terms
// (same rules as the frontend's schedulePayments in client/src/model.js).
function schedulePayments(debts, start) {
  const startKey = dateKey(start);
  const endKey = dateKey(addDays(start, HORIZON_DAYS - 1));
  const rows = [];

  for (const debt of debts) {
    const endDate = dateKey(debt.end_date);
    const monthly = Number(debt.monthly_payment);

    for (let offset = 0; offset < 4; offset++) {
      const lastDay = new Date(start.getFullYear(), start.getMonth() + offset + 1, 0).getDate();
      const due = new Date(
        start.getFullYear(),
        start.getMonth() + offset,
        Math.min(debt.payment_day, lastDay)
      );
      const key = dateKey(due);
      if (monthly > 0 && key >= startKey && key <= endKey && key <= endDate) {
        rows.push({ debt_id: debt.id, lender: debt.lender, due_date: key, amount: monthly, kind: 'monthly' });
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

// Works out one user's cash forecast for the next 90 days.
// Used by GET /api/wall and by the spoken alert (routes/alert.js).
async function computeWall(userId) {
  // Cash on hand = opening_cash (settings table, else STARTING_CASH from .env, else 0)
  // + all income - all expenses logged so far
  const [opening, net, recent, debtRows] = await Promise.all([
    pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'opening_cash'", [userId]),
    // Both sums read Tiger Data's daily_totals continuous aggregate (one row per day)
    // instead of scanning every transaction.
    pool.query(
      `SELECT COALESCE(SUM(income - expenses), 0) AS net
       FROM daily_totals WHERE user_id = $1`,
      [userId]
    ),
    // Last 60 days. Loan payments are left out (net_excl_loans) because future loan payments
    // are subtracted below.
    pool.query(
      `SELECT COALESCE(SUM(net_excl_loans), 0) AS net
       FROM daily_totals
       WHERE user_id = $1
         AND day >= date_trunc('day', now()) - interval '59 days'`,
      [userId]
    ),
    pool.query('SELECT * FROM debts WHERE user_id = $1 ORDER BY id', [userId]),
  ]);

  const openingCash = Number(opening.rows[0]?.value ?? process.env.STARTING_CASH ?? 0);
  const startingCash = openingCash + Number(net.rows[0].net);
  const averageDailyNet = Number(recent.rows[0].net) / 60;

  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const payments = schedulePayments(debtRows.rows, start);

  let cash = startingCash;
  let firstShortfall = null;
  const weeks = [];

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const key = dateKey(addDays(start, i));
    cash += averageDailyNet;

    const todays = payments.filter((p) => p.due_date === key);
    for (const p of todays) {
      cash -= p.amount;
      if (cash < 0 && !firstShortfall) firstShortfall = { ...p, shortfall: Math.abs(cash) };
    }

    const index = Math.floor(i / 7);
    if (!weeks[index]) {
      weeks[index] = {
        date: key,
        label: prettyDate(key),
        payments: 0,
        projected_cash: cash,
        min_cash: cash,
        shortfall: false,
      };
    }
    const week = weeks[index];
    week.payments += todays.reduce((n, p) => n + p.amount, 0);
    week.projected_cash = cash;
    week.min_cash = Math.min(week.min_cash, cash);
    week.shortfall = week.min_cash < 0;
  }

  return {
    starting_cash: startingCash,
    average_daily_net: averageDailyNet,
    weeks,
    payments,
    first_shortfall: firstShortfall,
  };
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
