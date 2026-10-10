const express = require('express');
const { generate } = require('../gemini');

const router = express.Router();

const CATEGORIES = ['sales', 'supplies', 'rent', 'payroll', 'equipment', 'loan_payment', 'other'];
const PAYMENT_METHODS = ['cash', 'card', 'other'];
const MAX_SPAN_DAYS = 31;

// "Catch-up": an owner who does not log every day says a whole stretch in one go, for example
// "this week we sold 3,200 and spent 1,900 on supplies and 480 on payroll". Each total becomes one
// entry that covers a range of days. The amount is spread evenly over those days when it is saved,
// so the forecast (which works day by day) stays accurate.

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const shift = (key, days) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());

const schema = {
  type: 'OBJECT',
  properties: {
    entries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['income', 'expense'] },
          amount: { type: 'NUMBER' },
          category: { type: 'STRING', enum: CATEGORIES },
          vendor: { type: 'STRING', nullable: true },
          payment_method: { type: 'STRING', enum: PAYMENT_METHODS },
          note: { type: 'STRING', nullable: true },
          date_from: { type: 'STRING' },
          date_to: { type: 'STRING' },
        },
        required: ['type', 'amount', 'category', 'payment_method', 'date_from', 'date_to'],
      },
    },
  },
  required: ['entries'],
};

function buildPrompt(text) {
  const today = todayKey();
  const monday = shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  return `A small business owner is summing up a stretch of time in one go. List each money total they mention as one entry.
The owner may speak any language. Fill every field in English using the allowed values.
Today is ${today}. This week started on ${monday} (Monday).
Rules:
- One entry per total: sales, and each kind of cost they name, separately. Do not invent amounts.
- date_from and date_to are YYYY-MM-DD, inclusive. "This week" is ${monday} to ${today}. "Last week" is ${shift(monday, -7)} to ${shift(monday, -1)}. "Yesterday" is a single day. If they name a number of days ("the last 10 days"), count back from today. If no period is said, use ${today} for both.
- Never go beyond today, and never span more than ${MAX_SPAN_DAYS} days.
- type is "income" for sales and money received, and "expense" for money paid out.
- category must be one of: ${CATEGORIES.join(', ')}. Food, ingredients, packaging, ice and propane are supplies. Paying staff is payroll. Loan or lender payments are loan_payment.
- payment_method is cash, card or other ("other" if not said). vendor and note are optional and short.

They said: "${text}"`;
}

function clean(entries) {
  const today = todayKey();
  const out = [];
  for (const e of entries) {
    const amount = Number(e.amount);
    if (
      !['income', 'expense'].includes(e.type) || !(amount > 0) || amount > 10_000_000 ||
      !CATEGORIES.includes(e.category) || !PAYMENT_METHODS.includes(e.payment_method) ||
      !isDate(e.date_from) || !isDate(e.date_to)
    ) continue;
    let to = e.date_to > today ? today : e.date_to;
    let from = e.date_from > to ? to : e.date_from;
    if ((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 >= MAX_SPAN_DAYS) from = shift(to, -(MAX_SPAN_DAYS - 1));
    out.push({
      date: to, // where the entry is shown; it is spread over from..to when saved
      date_from: from,
      date_to: to,
      type: e.type,
      amount: Math.round(amount * 100) / 100,
      category: e.category,
      vendor: e.vendor ? String(e.vendor).slice(0, 100) : null,
      payment_method: e.payment_method,
      note: e.note ? String(e.note).slice(0, 200) : null,
    });
  }
  return out.slice(0, 20);
}

router.post('/', async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 800) return res.status(400).json({ error: 'text is too long' });
  try {
    const response = await generate(
      { contents: buildPrompt(text), config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } },
      { prefer: 'lite' }
    );
    const transactions = clean(JSON.parse(response.text).entries || []);
    if (!transactions.length) {
      return res.status(422).json({ error: "I couldn't find any totals in that. Try: this week we sold 3,200 and spent 1,900 on supplies." });
    }
    res.json({ transactions });
  } catch (err) {
    console.error('[catchup] failed:', err.status || '', err.message?.slice(0, 160));
    if (err.status === 429) return res.status(429).json({ error: 'The assistant is busy. Please try again in a minute.' });
    res.status(502).json({ error: "Sorry, I couldn't work that out. Try saying it another way." });
  }
});

module.exports = router;
