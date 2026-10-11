require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const pool = require('./db');
const { requireAuth } = require('./auth');

const app = express();
// The app (on another address) must be allowed to read the renewed login token
app.use(cors({ exposedHeaders: ['X-Refreshed-Token'] }));
app.use(compression()); // JSON shrinks by about 85%, which matters on a phone's mobile data
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
app.use('/api/cash', require('./routes/cash'));

app.use('/api/parse', require('./routes/parse'));
app.use('/api/alert', require('./routes/alert'));
app.use('/api/summary', require('./routes/summary'));
app.use('/api/import', require('./routes/import'));
app.use('/api/language', require('./routes/language'));
app.use('/api/solve', require('./routes/solve'));
app.use('/api/ask', require('./routes/ask'));
app.use('/api/catchup', require('./routes/catchup'));
app.use('/api', require('./routes/voice').router); // /api/transcribe and /api/speak (ElevenLabs)

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  require('./phrasebook').warmChosenLanguages();
});
