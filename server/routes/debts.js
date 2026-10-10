const express = require('express');
const pool = require('../db');

const router = express.Router();

// pg returns NUMERIC columns as strings, so convert them to numbers for the frontend
const toDebt = (row) => ({
  ...row,
  balance: Number(row.balance),
  monthly_payment: Number(row.monthly_payment),
  rate_pct: row.rate_pct === null ? null : Number(row.rate_pct),
  payment_frequency: row.payment_frequency,
  payment_weekday: row.payment_weekday,
  balloon_amount: row.balloon_amount === null ? null : Number(row.balloon_amount),
  // DATE columns come back as JS dates; the frontend expects "YYYY-MM-DD"
  end_date: row.end_date && toDateKey(row.end_date),
  balloon_date: row.balloon_date && toDateKey(row.balloon_date),
});

const toDateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Every monthly payment from today until end_date, on payment_day
// (clamped to the last day of short months), plus the balloon payment if there is one.
function buildPayments(debt) {
  const payments = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${debt.end_date}T00:00:00`);
  const MAX_ROWS = 400; // a daily loan running for years would otherwise make thousands of rows

  if (debt.monthly_payment > 0 && debt.payment_frequency === 'monthly') {
    for (let m = 0; ; m++) {
      const lastDay = new Date(today.getFullYear(), today.getMonth() + m + 1, 0).getDate();
      const due = new Date(today.getFullYear(), today.getMonth() + m, Math.min(debt.payment_day, lastDay));
      if (due > end) break;
      if (due >= today) payments.push({ due_date: toDateKey(due), amount: debt.monthly_payment });
    }
  } else if (debt.monthly_payment > 0) {
    // Daily means every business day (Monday to Friday); weekly means one chosen weekday
    for (let d = new Date(today); d <= end && payments.length < MAX_ROWS; d.setDate(d.getDate() + 1)) {
      const due = debt.payment_frequency === 'daily' ? d.getDay() >= 1 && d.getDay() <= 5 : d.getDay() === debt.payment_weekday;
      if (due) payments.push({ due_date: toDateKey(d), amount: debt.monthly_payment });
    }
  }

  if (debt.balloon_amount > 0) {
    payments.push({ due_date: debt.balloon_date, amount: debt.balloon_amount });
  }
  return payments;
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM debts WHERE user_id = $1 ORDER BY id', [req.user.id]);
    res.json(result.rows.map(toDebt));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { lender, kind, rate_pct, end_date, balloon_date } = req.body;
  const balance = Number(req.body.balance);
  const monthly_payment = Number(req.body.monthly_payment || 0);
  const balloon_amount = Number(req.body.balloon_amount || 0);
  const payment_day = Number(req.body.payment_day);
  const payment_frequency = req.body.payment_frequency || 'monthly';
  const payment_weekday = Number(req.body.payment_weekday);

  if (!lender) return res.status(400).json({ error: 'lender is required' });
  if (!(balance >= 0)) return res.status(400).json({ error: 'balance must be a number' });
  if (!(monthly_payment >= 0) || !(balloon_amount >= 0)) {
    return res.status(400).json({ error: 'payments must be zero or more' });
  }
  if (monthly_payment === 0 && balloon_amount === 0) {
    return res.status(400).json({ error: 'Add a monthly payment or a balloon payment.' });
  }
  if (!['monthly', 'weekly', 'daily'].includes(payment_frequency)) {
    return res.status(400).json({ error: 'payment_frequency must be monthly, weekly or daily' });
  }
  if (payment_frequency === 'monthly' && (!Number.isInteger(payment_day) || payment_day < 1 || payment_day > 31)) {
    return res.status(400).json({ error: 'payment_day must be 1-31' });
  }
  if (payment_frequency === 'weekly' && (!Number.isInteger(payment_weekday) || payment_weekday < 0 || payment_weekday > 6)) {
    return res.status(400).json({ error: 'choose the day of the week the payment is taken' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date || '')) {
    return res.status(400).json({ error: 'end_date must be YYYY-MM-DD' });
  }
  if (balloon_amount > 0 && (!/^\d{4}-\d{2}-\d{2}$/.test(balloon_date || '') || balloon_date > end_date)) {
    return res.status(400).json({ error: 'balloon_date must be valid and no later than end_date' });
  }

  const client = await pool.connect();
  try {
    // Save the loan and its payments together: either both are saved or neither
    await client.query('BEGIN');
    const debtResult = await client.query(
      `INSERT INTO debts
         (lender, kind, balance, monthly_payment, rate_pct, payment_day, end_date, balloon_amount, balloon_date, user_id,
          payment_frequency, payment_weekday)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        lender, kind || null, balance, monthly_payment, rate_pct || null,
        payment_frequency === 'monthly' ? payment_day : null, end_date,
        balloon_amount > 0 ? balloon_amount : null,
        balloon_amount > 0 ? balloon_date : null,
        req.user.id,
        payment_frequency,
        payment_frequency === 'weekly' ? payment_weekday : null,
      ]
    );
    const debt = toDebt(debtResult.rows[0]);

    for (const p of buildPayments(debt)) {
      await client.query(
        'INSERT INTO debt_payments (debt_id, due_date, amount) VALUES ($1, $2, $3)',
        [debt.id, p.due_date, p.amount]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(debt);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
