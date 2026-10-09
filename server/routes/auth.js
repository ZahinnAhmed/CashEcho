const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { enabled, saveUser, signSession, requireAuth } = require('../auth');

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

    const user = await saveUser({
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null,
    });
    res.json({ token: signSession(user), user });
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

module.exports = router;
