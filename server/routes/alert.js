const express = require('express');
const { generate } = require('../gemini');
const { computeWall } = require('./wall');
const { synthesizeDataUrl } = require('./voice');
const { getLanguage } = require('../languages');
const { translateForSpeech } = require('../translate');

const router = express.Router();

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
// Chance of a shortfall by the due date, as a whole percent (null when there is too little history)
const pct = (s) => (s.probability == null ? null : Math.round(s.probability * 100));
const prettyDate = (key) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

// The wording used when there is nothing to warn about, or when Gemini is unavailable.
// It is built from the same numbers, so the alert always works.
function templateText(wall) {
  const s = wall.first_shortfall;
  if (s) {
    const what = s.kind === 'balloon' ? 'balloon payment' : 'payment';
    return (
      `Heads up. Your ${s.lender} ${what} of ${money(s.amount)} is due on ${prettyDate(s.due_date)}. ` +
      `At your current pace, you could be about ${money(s.shortfall)} short` +
      (pct(s) != null ? `, and there's about a ${pct(s)} percent chance of that happening. ` : '. ') +
      `There's still time to plan. It may help to talk to your lender early about a new payment plan.`
    );
  }
  if (!wall.payments.length) {
    return 'You have no loan payments coming up in the next 90 days. Add your loans and we will check that your cash can cover them.';
  }
  return 'Good news. At your current pace, you will have enough for every loan payment in the next 90 days. Keep logging your sales and costs so this stays accurate.';
}

// Gemini writes the alert from the shortfall numbers. The reply is only used if it states the
// exact figures; otherwise we fall back to the template, so the spoken numbers are never wrong.
async function geminiText(s) {
  const what = { balloon: 'balloon payment', daily: 'daily payment', weekly: 'weekly payment' }[s.kind] || 'monthly payment';
  const prompt = `Write a short spoken alert for a small business owner, in plain, warm, everyday English that anyone can understand (no finance jargon like refinancing, coverage or projected). Exactly 2 or 3 sentences, no lists, no markdown.
Facts (use these exactly):
- Lender: ${s.lender}
- Type: ${what}
- Amount due: ${money(s.amount)}
- Due date: ${prettyDate(s.due_date)}
- Projected shortfall: ${money(s.shortfall)}${pct(s) != null ? `\n- Chance of a shortfall by then: ${pct(s)} percent (say it as "${pct(s)} percent")` : ''}
Say which payment, when it is due, and how short the owner is projected to be${pct(s) != null ? ', along with the chance of a shortfall' : ''}. Then gently suggest talking to the lender early about a new payment plan, before the due date. Do not give financial advice, do not promise outcomes, and do not mention any other numbers.`;

  const response = await generate({
    contents: prompt,
    config: { temperature: 0 },
  });
  const text = (response.text || '').trim().replace(/\s+/g, ' ');
  const ok =
    text.includes(money(s.amount)) &&
    text.includes(money(s.shortfall)) &&
    text.toLowerCase().includes(String(s.lender).toLowerCase()) &&
    (pct(s) == null || new RegExp(`\\b${pct(s)}\\s?(%|percent)`, 'i').test(text));
  return ok ? text : null;
}

// Same facts -> same wording, so the alert is stable between calls and does not spend
// Gemini requests every time someone taps play.
const textCache = new Map();

router.get('/', async (req, res) => {
  try {
    const wall = await computeWall(req.user.id);
    const s = wall.first_shortfall;

    let text;
    if (!s) {
      text = templateText(wall);
    } else {
      const key = `${req.user.id}|${s.lender}|${s.kind}|${s.due_date}|${Math.round(s.amount)}|${Math.round(s.shortfall)}|${pct(s)}`;
      text = textCache.get(key);
      if (!text) {
        try {
          text = await geminiText(s);
        } catch (err) {
          console.error('[alert] Gemini failed, using template:', err.status || err.message);
        }
        text = text || templateText(wall);
        textCache.set(key, text);
      }
      // A warning built from a few days of entries should say so
      if (wall.early_days) {
        const days = wall.early_days === 1 ? '1 day' : `${wall.early_days} days`;
        text += ` This is based on only ${days} of entries, so treat it as a rough guide. Make sure you have entered the cash you have now.`;
      }
    }

    // Speak it in the owner's language (numbers are checked in the translation); if speech
    // fails the client speaks the text itself
    const spoken = await translateForSpeech(text, await getLanguage(req.user.id));
    let audioUrl = null;
    try {
      audioUrl = await synthesizeDataUrl(spoken.text, spoken.language);
    } catch (err) {
      console.error('[alert] TTS failed:', err.message);
    }

    res.json({ text: spoken.text, text_en: text, language: spoken.language, audioUrl, audio_url: audioUrl, first_shortfall: s });
  } catch (err) {
    console.error('[alert] failed:', err.message);
    res.status(500).json({ error: 'alert_failed' });
  }
});

module.exports = router;
