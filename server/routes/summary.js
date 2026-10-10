const express = require('express');
const pool = require('../db');
const { computeWall, monthlyEquivalent } = require('./wall');

const router = express.Router();

const toDateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Everything on the lender summary page, for the signed-in user. All numbers come from the
// owner's own ledger and loans; the page only arranges them.
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const [monthly, categories, debts, wall] = await Promise.all([
      // Last three calendar months (this one included), from the daily_totals aggregate
      pool.query(
        `SELECT to_char(date_trunc('month', day AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                SUM(income) AS income,
                SUM(income) - SUM(net_excl_loans) AS operating_expenses,
                SUM(net_excl_loans) AS operating_cash,
                SUM(expenses) - (SUM(income) - SUM(net_excl_loans)) AS loan_payments_logged
         FROM daily_totals
         WHERE user_id = $1
           AND day >= date_trunc('month', now()) - interval '2 months'
         GROUP BY 1
         ORDER BY 1`,
        [userId]
      ),
      pool.query(
        `SELECT category, SUM(amount) AS amount
         FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND category <> 'loan_payment'
           AND occurred_at >= date_trunc('day', now()) - interval '89 days'
         GROUP BY category
         ORDER BY amount DESC`,
        [userId]
      ),
      pool.query('SELECT * FROM debts WHERE user_id = $1 ORDER BY id', [userId]),
      computeWall(userId),
    ]);

    const expenseTotal = categories.rows.reduce((n, r) => n + Number(r.amount), 0);
    const num = (v) => Number(v);

    res.json({
      generated_at: new Date().toISOString(),
      business_name: req.user.name,
      monthly: monthly.rows.map((r) => ({
        month: r.month,
        income: num(r.income),
        operating_expenses: num(r.operating_expenses),
        operating_cash: num(r.operating_cash),
        loan_payments_logged: num(r.loan_payments_logged),
      })),
      expense_categories: categories.rows.map((r) => ({
        category: r.category,
        amount: num(r.amount),
        share: expenseTotal ? num(r.amount) / expenseTotal : 0,
      })),
      debts: debts.rows.map((d) => ({
        lender: d.lender,
        kind: d.kind,
        balance: num(d.balance),
        monthly_payment: num(d.monthly_payment),
        rate_pct: d.rate_pct === null ? null : num(d.rate_pct),
        payment_day: d.payment_day,
        payment_frequency: d.payment_frequency,
        payment_weekday: d.payment_weekday,
        monthly_equivalent: monthlyEquivalent(d),
        end_date: toDateKey(d.end_date),
        balloon_amount: d.balloon_amount === null ? null : num(d.balloon_amount),
        balloon_date: d.balloon_date ? toDateKey(d.balloon_date) : null,
      })),
      coverage: wall.coverage,
      cash_on_hand: wall.starting_cash,
      first_shortfall: wall.first_shortfall,
      shortfall_probability: wall.shortfall_probability,
      uncertainty: wall.uncertainty,
      upcoming_payments: wall.payments,
    });
  } catch (err) {
    console.error('[summary] failed:', err.message);
    res.status(500).json({ error: 'summary_failed' });
  }
});

module.exports = router;
