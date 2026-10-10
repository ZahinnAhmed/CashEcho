const express = require('express');
const pool = require('../db');
const { refreshDay } = require('../db/refresh');

const router = express.Router();

// pg returns NUMERIC columns as strings, so convert amount to a number for the frontend
const toTransaction = (row) => ({ ...row, amount: Number(row.amount) });

// The frontend works with a plain "YYYY-MM-DD" date, so every query also returns one
const DATE_COLUMN = "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date";

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      // The newest 500 entries: enough for the ledger screen, and the list cannot grow without limit.
      // Weekly totals and the forecast read the daily_totals aggregate, so they cover everything.
      `SELECT *, ${DATE_COLUMN} FROM transactions WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 500`,
      [req.user.id]
    );
    res.json(result.rows.map(toTransaction));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Weekly income and expenses, newest week first (weeks start on Monday).
// This reads Tiger Data's daily_totals continuous aggregate and groups it with time_bucket.
router.get('/weekly', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT to_char(time_bucket('7 days', day, TIMESTAMPTZ '2000-01-03 00:00:00+00') AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
              SUM(income) AS income,
              SUM(expenses) AS expenses
       FROM daily_totals
       WHERE user_id = $1
       GROUP BY 1
       ORDER BY 1 DESC`,
      [req.user.id]
    );
    res.json(result.rows.map((r) => ({ date: r.date, income: Number(r.income), expenses: Number(r.expenses) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save many entries at once (used after reviewing an import). All or nothing.
router.post('/bulk', async (req, res) => {
  const items = Array.isArray(req.body.transactions) ? req.body.transactions : [];
  if (!items.length) return res.status(400).json({ error: 'No transactions to save.' });
  if (items.length > 200) return res.status(400).json({ error: 'Too many at once (200 at most).' });

  const categories = ['sales', 'supplies', 'rent', 'payroll', 'equipment', 'loan_payment', 'other'];
  const methods = ['cash', 'card', 'other'];
  for (const t of items) {
    if (!['income', 'expense'].includes(t.type) || !(Number(t.amount) > 0) || !categories.includes(t.category) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || (t.payment_method && !methods.includes(t.payment_method))) {
      return res.status(400).json({ error: 'One of the entries is not valid. Please check them and try again.' });
    }
  }

  // An entry that covers a range of days (a weekly total) is split evenly across those days, so the
  // forecast, which works day by day, sees steady sales instead of one big lump. Cents left over
  // go on the last day, so the pieces add up to exactly the total.
  const rows = [];
  for (const t of items) {
    const from = t.date_from, to = t.date_to;
    if (from && to && from < to) {
      const start = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`);
      const days = Math.round((end - start) / 86400000) + 1;
      if (!(days >= 2 && days <= 31) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: 'A date range can cover 2 to 31 days.' });
      }
      const cents = Math.round(Number(t.amount) * 100);
      const each = Math.floor(cents / days);
      for (let i = 0; i < days; i++) {
        const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        rows.push({ ...t, date: day, amount: (i === days - 1 ? cents - each * (days - 1) : each) / 100,
          note: `${t.note ? t.note + ' · ' : ''}part of a ${from} to ${to} total` });
      }
    } else {
      rows.push(t);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of rows) {
      await client.query(
        `INSERT INTO transactions
           (user_id, occurred_at, type, amount, category, vendor, payment_method, note, raw_text)
         VALUES ($1, ($2::date + interval '12 hours') AT TIME ZONE 'UTC', $3, $4, $5, $6, $7, $8, 'Imported from a photo or file')`,
        [req.user.id, t.date, t.type, t.amount, t.category, t.vendor || null, t.payment_method || 'other', t.note || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[bulk] failed:', err.message);
    return res.status(500).json({ error: 'Could not save those entries. Please try again.' });
  } finally {
    client.release();
  }

  // Bring the daily totals up to date for the days that changed
  const dates = rows.map((t) => t.date).sort();
  try {
    await pool.query(
      `CALL refresh_continuous_aggregate('daily_totals',
         ($1::date)::timestamp AT TIME ZONE 'UTC',
         (($2::date) + 1)::timestamp AT TIME ZONE 'UTC')`,
      [dates[0], dates[dates.length - 1]]
    );
  } catch (err) {
    console.error('[daily_totals] refresh failed:', err.message);
  }
  res.status(201).json({ saved: items.length, rows_written: rows.length });
});

router.post('/', async (req, res) => {
  const { date, type, amount, category, vendor, payment_method, note, raw_text } = req.body;

  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: "type must be 'income' or 'expense'" });
  }
  if (!(Number(amount) > 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (!category) {
    return res.status(400).json({ error: 'category is required' });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO transactions
         (user_id, occurred_at, type, amount, category, vendor, payment_method, note, raw_text)
       VALUES ($9, COALESCE(($1::date + interval '12 hours') AT TIME ZONE 'UTC', now()), $2, $3, $4, $5, $6, $7, $8)
       RETURNING *, ${DATE_COLUMN}`,
      [date || null, type, amount, category, vendor, payment_method, note, raw_text, req.user.id]
    );
    await refreshDay(result.rows[0].date);
    res.status(201).json(toTransaction(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM transactions WHERE id = $1 AND user_id = $2
       RETURNING to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'transaction not found' });
    }
    await refreshDay(result.rows[0].date);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
