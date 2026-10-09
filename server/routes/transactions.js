const express = require('express');
const pool = require('../db');

const router = express.Router();

// pg returns NUMERIC columns as strings, so convert amount to a number for the frontend
const toTransaction = (row) => ({ ...row, amount: Number(row.amount) });

// The frontend works with a plain "YYYY-MM-DD" date, so every query also returns one
const DATE_COLUMN = "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date";

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, ${DATE_COLUMN} FROM transactions ORDER BY occurred_at DESC`
    );
    res.json(result.rows.map(toTransaction));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
         (occurred_at, type, amount, category, vendor, payment_method, note, raw_text)
       VALUES (COALESCE(($1::date + interval '12 hours') AT TIME ZONE 'UTC', now()), $2, $3, $4, $5, $6, $7, $8)
       RETURNING *, ${DATE_COLUMN}`,
      [date || null, type, amount, category, vendor, payment_method, note, raw_text]
    );
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
    const result = await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'transaction not found' });
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
