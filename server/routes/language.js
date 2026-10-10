const express = require('express');
const { LANGUAGES, isSupported, getLanguage, setLanguage } = require('../languages');
const { warmPhrasebook } = require('../phrasebook');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json({
      language: await getLanguage(req.user.id),
      languages: LANGUAGES.map(({ code, label, tag }) => ({ code, label, tag })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  const code = req.body.language;
  if (!isSupported(code)) return res.status(400).json({ error: 'That language is not supported.' });
  try {
    await setLanguage(req.user.id, code);
    warmPhrasebook(code); // translate the fixed confirmation words now, so the first one is quick
    res.json({ language: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
