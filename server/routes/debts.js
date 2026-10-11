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

// Checks a loan from the form. Returns { error } or { values } in the column order used below.
function readDebt(body) {
  const { lender, kind, rate_pct, end_date, balloon_date } = body;
  const balance = Number(body.balance);
  const monthly_payment = Number(body.monthly_payment || 0);
  const balloon_amount = Number(body.balloon_amount || 0);
  const payment_day = Number(body.payment_day);
  const payment_frequency = body.payment_frequency || 'monthly';
  const payment_weekday = Number(body.payment_weekday);

  if (!lender || !String(lender).trim()) return { error: 'Enter who the loan is from.' };
  if (!(balance >= 0)) return { error: 'Enter how much you still owe.' };
  if (!(monthly_payment >= 0) || !(balloon_amount >= 0)) return { error: 'Payments must be zero or more.' };
  if (monthly_payment === 0 && balloon_amount === 0) return { error: 'Add a regular payment or a final payment.' };
  if (!['monthly', 'weekly', 'daily'].includes(payment_frequency)) return { error: 'Choose how often you pay.' };
  if (payment_frequency === 'monthly' && (!Number.isInteger(payment_day) || payment_day < 1 || payment_day > 31)) {
    return { error: 'The payment day must be between 1 and 31.' };
  }
  if (payment_frequency === 'weekly' && (!Number.isInteger(payment_weekday) || payment_weekday < 0 || payment_weekday > 6)) {
    return { error: 'Choose the day of the week the payment is taken.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date || '')) return { error: 'Enter when the loan ends.' };
  if (balloon_amount > 0 && (!/^\d{4}-\d{2}-\d{2}$/.test(balloon_date || '') || balloon_date > end_date)) {
    return { error: 'The final payment date must be on or before the loan end date.' };
  }
  return {
    values: [
      String(lender).trim(), kind || null, balance, monthly_payment, rate_pct || null,
      payment_frequency === 'monthly' ? payment_day : null, end_date,
      balloon_amount > 0 ? balloon_amount : null,
      balloon_amount > 0 ? balloon_date : null,
      payment_frequency,
      payment_frequency === 'weekly' ? payment_weekday : null,
    ],
  };
}

// Replace a loan's stored payment rows with ones worked out from its current terms
async function savePayments(client, debt) {
  await client.query('DELETE FROM debt_payments WHERE debt_id = $1', [debt.id]);
  for (const p of buildPayments(debt)) {
    await client.query(
      'INSERT INTO debt_payments (debt_id, due_date, amount) VALUES ($1, $2, $3)',
      [debt.id, p.due_date, p.amount]
    );
  }
}

// Runs `work` in one database transaction: either everything is saved or nothing is
async function inTransaction(res, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await work(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

router.post('/', async (req, res) => {
  const { error, values } = readDebt(req.body);
  if (error) return res.status(400).json({ error });

  await inTransaction(res, async (client) => {
    const result = await client.query(
      `INSERT INTO debts
         (lender, kind, balance, monthly_payment, rate_pct, payment_day, end_date, balloon_amount, balloon_date,
          payment_frequency, payment_weekday, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [...values, req.user.id]
    );
    const debt = toDebt(result.rows[0]);
    await savePayments(client, debt);
    res.status(201).json(debt);
  });
});

// Change a loan's terms (only the owner's own loans)
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Loan not found.' });
  const { error, values } = readDebt(req.body);
  if (error) return res.status(400).json({ error });

  await inTransaction(res, async (client) => {
    const result = await client.query(
      `UPDATE debts SET
         lender = $1, kind = $2, balance = $3, monthly_payment = $4, rate_pct = $5, payment_day = $6,
         end_date = $7, balloon_amount = $8, balloon_date = $9, payment_frequency = $10, payment_weekday = $11
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [...values, id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Loan not found.' });
    const debt = toDebt(result.rows[0]);
    await savePayments(client, debt);
    res.json(debt);
  });
});

// Remove a loan; its payment rows go with it (ON DELETE CASCADE)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Loan not found.' });
  try {
    const result = await pool.query('DELETE FROM debts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Loan not found.' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
