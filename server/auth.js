require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const jwt = require('jsonwebtoken');
const pool = require('./db');

// Google sign-in is switched on by setting GOOGLE_CLIENT_ID in server/.env.
// Without it the API stays open and everything belongs to one local dev user.
const enabled = Boolean(process.env.GOOGLE_CLIENT_ID);

if (enabled && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add a long random string to server/.env');
}
if (!enabled) {
  console.warn('GOOGLE_CLIENT_ID is not set: the API is NOT protected by login.');
}

// Creates the user on first sign-in, or updates their name, picture and last login
async function saveUser({ email, name, picture }) {
  const result = await pool.query(
    `INSERT INTO users (email, name, picture)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, picture = EXCLUDED.picture, last_login_at = now()
     RETURNING id, email, name, picture`,
    [email, name, picture]
  );
  return result.rows[0];
}

// Our own session token, handed out after Google confirms who the user is.
// It carries the user's database id (uid), which every route uses to find their data.
const signSession = (user) =>
  jwt.sign(
    { uid: user.id, email: user.email, name: user.name, picture: user.picture },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

let devUser = null;

// Express middleware: lets the request through only with a valid session token,
// and sets req.user = { id, email, name, picture }
async function requireAuth(req, res, next) {
  if (!enabled) {
    try {
      devUser = devUser || (await saveUser({ email: 'local-dev@cashecho.local', name: 'Local dev', picture: null }));
      req.user = devUser;
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.uid) return res.status(401).json({ error: 'Please sign in again.' });
    req.user = { id: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

module.exports = { enabled, saveUser, signSession, requireAuth };
