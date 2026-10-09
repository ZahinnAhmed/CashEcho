const express = require('express');
const { ai, MODEL } = require('../gemini');
const { computeWall } = require('./wall');
const { synthesizeDataUrl } = require('./voice');

const router = express.Router();

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
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
      `Based on your recent cash flow, you are projected to be about ${money(s.shortfall)} short. ` +
      `It may be a good time to talk to your lender about refinancing or a new payment plan.`
    );
  }
  if (!wall.payments.length) {
    return 'You have no loan payments coming up in the next 90 days. Add your loans to see how your cash lines up against them.';
  }
  return 'Good news. Your projected cash covers every scheduled loan payment for the next 90 days. Keep logging your sales and expenses to keep the forecast current.';
}

// Gemini writes the alert from the shortfall numbers. The reply is only used if it states the
// exact figures; otherwise we fall back to the template, so the spoken numbers are never wrong.
async function geminiText(s) {
  const what = s.kind === 'balloon' ? 'balloon payment' : 'monthly payment';
  const prompt = `Write a short spoken alert for a small business owner, in plain, warm English. Exactly 2 or 3 sentences, no lists, no markdown.
Facts (use these exactly):
- Lender: ${s.lender}
- Type: ${what}
- Amount due: ${money(s.amount)}
- Due date: ${prettyDate(s.due_date)}
- Projected shortfall: ${money(s.shortfall)}
Say which payment, when it is due, and how short the owner is projected to be. Then gently suggest talking to the lender about refinancing or a new payment plan before the due date. Do not give financial advice, do not promise outcomes, and do not mention any other numbers.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 0 },
  });
  const text = (response.text || '').trim().replace(/\s+/g, ' ');
  const ok =
    text.includes(money(s.amount)) &&
    text.includes(money(s.shortfall)) &&
    text.toLowerCase().includes(String(s.lender).toLowerCase());
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
      const key = `${req.user.id}|${s.lender}|${s.kind}|${s.due_date}|${Math.round(s.amount)}|${Math.round(s.shortfall)}`;
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
    }

    // Turn the text into speech; if that fails the client speaks the text itself
    let audioUrl = null;
    try {
      audioUrl = await synthesizeDataUrl(text);
    } catch (err) {
      console.error('[alert] TTS failed:', err.message);
    }

    res.json({ text, audioUrl, audio_url: audioUrl, first_shortfall: s });
  } catch (err) {
    console.error('[alert] failed:', err.message);
    res.status(500).json({ error: 'alert_failed' });
  }
});

module.exports = router;
