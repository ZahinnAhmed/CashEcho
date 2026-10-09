require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  const result = await pool.query('SELECT now()');
  res.json({ ok: true, time: result.rows[0].now });
});

// Sign-in routes and the health check are public; every route below needs a session token
app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth);

app.use('/api/transactions', require('./routes/transactions'));

app.use('/api/debts', require('./routes/debts'));

app.use('/api/wall', require('./routes/wall'));

app.use('/api/parse', require('./routes/parse'));
app.use('/api', require('./routes/voice').router); // /api/transcribe and /api/speak (ElevenLabs)

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
