const express = require('express');
const pool = require('../db');

const router = express.Router();

// The owner says how much cash they have right now. The forecast adds every logged entry to a
// saved opening balance, so we store the balance that makes those add up to what they said:
// opening_cash = cash on hand today - everything logged so far.
router.put('/', async (req, res) => {
  const cash = Number(req.body.cash);
  if (!Number.isFinite(cash) || cash < 0 || cash > 100000000) {
    return res.status(400).json({ error: 'Cash on hand must be zero or greater.' });
  }
  try {
    const net = await pool.query(
      'SELECT COALESCE(SUM(income - expenses), 0) AS net FROM daily_totals WHERE user_id = $1',
      [req.user.id]
    );
    const opening = Math.round((cash - Number(net.rows[0].net)) * 100) / 100;
    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, 'opening_cash', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, String(opening)]
    );
    res.json({ starting_cash: cash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
