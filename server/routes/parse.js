const express = require('express');
const { ai, MODEL } = require('../gemini');

const router = express.Router();

const CATEGORIES = ['sales', 'supplies', 'rent', 'payroll', 'equipment', 'loan_payment', 'other'];
const PAYMENT_METHODS = ['cash', 'card', 'other'];

// Tells Gemini the exact JSON shape to return (the locked transaction schema)
const responseSchema = {
  type: 'OBJECT',
  properties: {
    is_transaction: { type: 'BOOLEAN' },
    type: { type: 'STRING', enum: ['income', 'expense'] },
    amount: { type: 'NUMBER' },
    category: { type: 'STRING', enum: CATEGORIES },
    vendor: { type: 'STRING', nullable: true },
    payment_method: { type: 'STRING', enum: PAYMENT_METHODS },
    date: { type: 'STRING' },
    note: { type: 'STRING', nullable: true },
  },
  required: ['is_transaction', 'type', 'amount', 'category', 'payment_method', 'date'],
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function buildPrompt(text) {
  return `You turn what a small food-cart owner says into one bookkeeping entry.
Today's date is ${todayKey()}. Resolve words like "today" or "yesterday" to a YYYY-MM-DD date; use today if no day is said.
type is "income" for money received (sales, tips) and "expense" for money paid out.
category must be one of: ${CATEGORIES.join(', ')}. Use loan_payment for loan, lender or financing payments.
payment_method is cash, card or other; use "other" if not said.
vendor is the business or person named, or null. note is a short detail like "flour", or null.
amount is a positive number in dollars.
is_transaction is false if the owner did not describe a sale or payment with an amount (then fill the other fields with placeholders).

The owner said: "${text}"`;
}

// Check Gemini's answer against the schema instead of trusting it
function validate(t) {
  if (!['income', 'expense'].includes(t.type)) return 'type must be income or expense';
  if (!(Number(t.amount) > 0)) return 'amount must be a positive number';
  if (!CATEGORIES.includes(t.category)) return 'category is not allowed';
  if (!PAYMENT_METHODS.includes(t.payment_method)) return 'payment_method is not allowed';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return 'date must be YYYY-MM-DD';
  return null;
}

async function askGemini(text) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(text),
    config: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
  });
  return JSON.parse(response.text);
}

router.post('/', async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 500) return res.status(400).json({ error: 'text is too long' });

  // Try twice: if the first answer is bad JSON or fails validation, ask once more
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = await askGemini(text);
      if (parsed.is_transaction === false) {
        return res.status(422).json({ error: "I couldn't find a sale or payment in that. Try something like \"Paid $340 for flour\"." });
      }
      lastError = validate(parsed);
      if (!lastError) {
        return res.json({
          type: parsed.type,
          amount: Number(parsed.amount),
          category: parsed.category,
          vendor: parsed.vendor || null,
          payment_method: parsed.payment_method,
          date: parsed.date,
          note: parsed.note || null,
        });
      }
    } catch (err) {
      // Quota or network problems won't be fixed by asking again, and the raw message is noisy
      if (err.status === 429) {
        console.error('Gemini quota exceeded');
        return res.status(429).json({ error: 'The assistant is busy. Please try again in a minute.' });
      }
      lastError = err.message;
    }
  }
  console.error('Parse failed:', lastError);
  res.status(502).json({ error: 'Could not understand that entry. Please edit it by hand.' });
});

module.exports = router;
