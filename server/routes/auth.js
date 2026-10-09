const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const { enabled, saveUser, signSession, requireAuth } = require('../auth');
const { hashPassword, verifyPassword } = require('../passwords');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// The frontend asks this first, so it knows whether to show the Google button.
// The client ID is public by design (it is also visible in the browser), not a secret.
router.get('/config', (req, res) => {
  res.json({ enabled, google_client_id: enabled ? process.env.GOOGLE_CLIENT_ID : null });
});

// Who is signed in right now (used to show their name after a page reload)
router.get('/me', requireAuth, (req, res) => {
  res.json({ name: req.user.name, picture: req.user.picture || null });
});

// The browser sends the ID token Google gave it; we check it with Google and
// return our own session token.
router.post('/google', async (req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Google sign-in is not set up on the server.' });

  const credential = req.body.credential;
  if (typeof credential !== 'string' || !credential) {
    return res.status(400).json({ error: 'credential is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Your Google email is not verified.' });
    }

    const user = await saveUser(
      { email: payload.email, name: payload.name || payload.email, picture: payload.picture || null },
      { verified: true }
    );
    res.json({ token: signSession(user), user });
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// ---- Email + password accounts ----

// Slows down password guessing: at most 10 tries per email and address every 15 minutes
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, recent);
  return recent.length >= 10;
}
const recordAttempt = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

router.post('/signup', async (req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Sign-up is not set up on the server.' });

  const name = String(req.body.name || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!name || name.length > 100) return res.status(400).json({ error: 'Please enter your name.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Your password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({
        error: existing.rows[0].password_hash
          ? 'An account with this email already exists. Please sign in.'
          : 'This email is registered with Google. Please use Sign in with Google.',
      });
    }

    const hash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, name, picture`,
      [email, name, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signSession(user), user });
  } catch (err) {
    // Two sign-ups at the same moment: the unique email rule rejects the second
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    console.error('Sign-up failed:', err.message);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Sign-in is not set up on the server.' });

  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Please enter your email and password.' });

  const key = `${req.ip}|${email}`;
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, picture, password_hash FROM users WHERE email = $1',
      [email]
    );
    const row = result.rows[0];
    // Always do the hash work, so an unknown email takes as long as a wrong password
    const ok = await verifyPassword(password, row?.password_hash || 'x:y');
    if (!row || !row.password_hash || !ok) {
      recordAttempt(key);
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    attempts.delete(key);
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    const user = { id: row.id, email: row.email, name: row.name, picture: row.picture };
    res.json({ token: signSession(user), user });
  } catch (err) {
    console.error('Sign-in failed:', err.message);
    res.status(500).json({ error: 'Could not sign you in. Please try again.' });
  }
});

module.exports = router;
