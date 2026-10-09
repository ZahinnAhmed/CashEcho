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

// "Today" is the cart's calendar day in New York, not the server's clock (a UTC host
// would say tomorrow after 8 pm Eastern)
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function buildPrompt(text) {
  const today = todayKey();
  return `You turn what a small food-cart owner says into one bookkeeping entry.
Today's date is ${today}. Resolve words like "today" or "yesterday" to a YYYY-MM-DD date; use today if no day is said.
type is "income" for money received (sales, tips) and "expense" for money paid out.
category must be one of: ${CATEGORIES.join(', ')}.
- Food, ingredients, napkins, foil, ice and propane refills are supplies.
- Durable items (a new tank, a grill, cart parts) are equipment.
- Paying a helper or staff is payroll.
- The commissary or a parking spot "for rent" is rent.
- Loan, lender or financing payments are loan_payment.
payment_method is cash, card or other.
- card, debit, credit, Square or tap mean card.
- Zelle, Cash App, Venmo or check mean other.
- Use "other" if not said.
vendor is the business or person named, in Title Case as spoken (Restaurant Depot, Jetro, Sysco, Commissary, SBA), or null.
The transcript comes from speech-to-text, which writes "Sysco" as "Cisco": a food cart's "Cisco delivery" is Sysco.
note is a short detail like "flour", or null.
amount is a positive number in dollars. Spoken numbers are dollars:
- "three forty" is 340, "four eighty" is 480, "six fifty" is 650, "eighty seven fifty" is 87.50.
- "a buck fifty" is 1.50, "a hundred twenty bucks" is 120. "About" or "around" X means X.
- Speech-to-text writes "three forty" as "$3.40" and "six fifty" as "$6.50". If a single-digit amount with cents is implausibly small for what it pays for (bulk supplies, a day's sales, rent, a loan payment), read it as the whole number: "$3.40" is 340, "$6.50" is 650. Real small amounts like "a buck fifty" for ice stay as they are.
is_transaction is false if the owner did not describe a sale or payment with an amount (then fill the other fields with placeholders).

Examples:
"Restaurant Depot, three forty, flour and oil, paid cash"
-> {"is_transaction":true,"type":"expense","amount":340,"category":"supplies","vendor":"Restaurant Depot","payment_method":"cash","date":"${today}","note":"flour and oil"}
"Zelle'd the commissary 600 for rent"
-> {"is_transaction":true,"type":"expense","amount":600,"category":"rent","vendor":"Commissary","payment_method":"other","date":"${today}","note":"rent"}
"Sold 40 gyros, about 480 cash"
-> {"is_transaction":true,"type":"income","amount":480,"category":"sales","vendor":null,"payment_method":"cash","date":"${today}","note":"40 gyros"}
"Picked up napkins and foil at Jetro, eighty seven fifty on the card"
-> {"is_transaction":true,"type":"expense","amount":87.5,"category":"supplies","vendor":"Jetro","payment_method":"card","date":"${today}","note":"napkins and foil"}

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

// Used on the second try, in case the main model is overloaded (Gemini sometimes answers 503)
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

async function askGemini(text, model = MODEL) {
  const response = await ai.models.generateContent({
    model,
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
      const parsed = await askGemini(text, attempt === 0 ? MODEL : FALLBACK_MODEL);
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
      console.error(`Parse attempt ${attempt + 1} failed:`, err.message);
      // Overloaded: wait a moment so the retry doesn't hit the same spike
      if (err.status === 503) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error('Parse failed:', lastError);
  res.status(502).json({ error: 'Could not understand that entry. Please edit it by hand.' });
});

module.exports = router;
