const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { generate } = require('../gemini');

const router = express.Router();

const CATEGORIES = ['sales', 'supplies', 'rent', 'payroll', 'equipment', 'loan_payment', 'other'];
const PAYMENT_METHODS = ['cash', 'card', 'other'];
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_FILES = 5;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // Gemini accepts about 20 MB of inline files per request
const MAX_ROWS = 200;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// Each import is one Gemini call with images, so limit how often one person can do it
const recent = new Map();
function tooManyImports(userId) {
  const now = Date.now();
  const times = (recent.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
  recent.set(userId, times);
  return times.length >= 10;
}

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const responseSchema = {
  type: 'OBJECT',
  properties: {
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          type: { type: 'STRING', enum: ['income', 'expense'] },
          amount: { type: 'NUMBER' },
          category: { type: 'STRING', enum: CATEGORIES },
          vendor: { type: 'STRING', nullable: true },
          payment_method: { type: 'STRING', enum: PAYMENT_METHODS },
          note: { type: 'STRING', nullable: true },
        },
        required: ['date', 'type', 'amount', 'category', 'payment_method'],
      },
    },
  },
  required: ['transactions'],
};

function buildPrompt() {
  const today = todayKey();
  return `You read a small business owner's old records and list every money-in and money-out entry.
The attached files may be photos of receipts, handwritten ledger or notebook pages, bank or card statements, or PDFs of them.
Today's date is ${today}.
Rules:
- One entry per line item of money received or paid. Do not invent entries. If something is unreadable or unclear, leave it out.
- Skip totals, subtotals, running balances, opening balances, tax summary lines and page headers.
- date is YYYY-MM-DD. If the year is missing, use the most recent past date for that day and month. If there is no date at all, use ${today}.
- amount is a positive number in dollars (no currency symbol).
- type is "income" for sales, deposits and money received, and "expense" for purchases and payments out.
- category must be one of: ${CATEGORIES.join(', ')}. Food, ingredients, packaging, ice and propane are supplies. Durable items such as a grill or cart parts are equipment. Paying staff is payroll. Loan, lender or financing payments are loan_payment. Use other if unsure.
- payment_method is cash, card or other (use "other" if not shown).
- vendor is the business or person named, in Title Case, or null. note is a short detail, or null.
- Return at most ${MAX_ROWS} entries. If the files contain no transactions, return an empty list.`;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());

// Keep only entries that fit the ledger's rules, instead of trusting the model's answer
function clean(rows) {
  const today = todayKey();
  const out = [];
  let dropped = 0;
  for (const r of rows) {
    const amount = Number(r.amount);
    if (
      !['income', 'expense'].includes(r.type) ||
      !(amount > 0) ||
      amount > 10_000_000 ||
      !CATEGORIES.includes(r.category) ||
      !PAYMENT_METHODS.includes(r.payment_method) ||
      !isDate(r.date) ||
      r.date > today // a record cannot be dated in the future
    ) {
      dropped++;
      continue;
    }
    out.push({
      date: r.date,
      type: r.type,
      amount: Math.round(amount * 100) / 100,
      category: r.category,
      vendor: r.vendor ? String(r.vendor).slice(0, 100) : null,
      payment_method: r.payment_method,
      note: r.note ? String(r.note).slice(0, 200) : null,
    });
  }
  return { rows: out.slice(0, MAX_ROWS), dropped };
}

// Mark entries that are already in the ledger (same day, type and amount), so importing the
// same page twice does not double-count it
async function markDuplicates(userId, rows) {
  if (!rows.length) return rows;
  const dates = rows.map((r) => r.date).sort();
  const existing = await pool.query(
    `SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, type, amount
     FROM transactions
     WHERE user_id = $1
       AND occurred_at >= ($2::date)::timestamp AT TIME ZONE 'UTC'
       AND occurred_at <  (($3::date) + 1)::timestamp AT TIME ZONE 'UTC'`,
    [userId, dates[0], dates[dates.length - 1]]
  );
  const seen = new Set(existing.rows.map((e) => `${e.date}|${e.type}|${Number(e.amount).toFixed(2)}`));
  return rows.map((r) => ({ ...r, duplicate: seen.has(`${r.date}|${r.type}|${r.amount.toFixed(2)}`) }));
}

router.post('/', (req, res) => {
  upload.array('files', MAX_FILES)(req, res, async (uploadError) => {
    if (uploadError) {
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? 'Each file must be under 6 MB. Try a smaller photo.' : 'Could not read the upload.',
      });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Add at least one photo or PDF.' });
    if (files.some((f) => !ALLOWED_TYPES.includes(f.mimetype))) {
      return res.status(400).json({ error: 'Only photos (JPG, PNG, WebP, HEIC) and PDFs are supported.' });
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: 'Those files are too large together. Add fewer pages at a time.' });
    }
    if (tooManyImports(req.user.id)) {
      return res.status(429).json({ error: 'You have imported a lot in the last hour. Please try again later.' });
    }
    recent.set(req.user.id, [...(recent.get(req.user.id) || []), Date.now()]);

    try {
      const response = await generate({
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt() },
              ...files.map((f) => ({ inlineData: { mimeType: f.mimetype, data: f.buffer.toString('base64') } })),
            ],
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
      }, { fast: true, attemptMs: 30000, totalMs: 60000 }); // several pages can take a while

      const parsed = JSON.parse(response.text);
      const { rows, dropped } = clean(Array.isArray(parsed.transactions) ? parsed.transactions : []);
      const transactions = await markDuplicates(req.user.id, rows);
      res.json({ transactions, skipped: dropped, files: files.length });
    } catch (err) {
      console.error('[import] failed:', err.status || '', err.message?.slice(0, 200));
      if (err.status === 429) {
        return res.status(429).json({ error: 'The assistant is busy. Please try again in a minute.' });
      }
      res.status(502).json({ error: "Couldn't read those files. Try a clearer, well-lit photo." });
    }
  });
});

module.exports = router;
