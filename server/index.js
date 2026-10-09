require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  const result = await pool.query('SELECT now()');
  res.json({ ok: true, time: result.rows[0].now });
});

app.use('/api/transactions', require('./routes/transactions'));

app.use('/api/debts', require('./routes/debts'));

app.use('/api/wall', require('./routes/wall'));

app.use('/api/parse', require('./routes/parse'));

app.listen(3001, () => console.log('Server running on http://localhost:3001'));
