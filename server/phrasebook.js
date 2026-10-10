const { generate } = require('./gemini');
const { find } = require('./languages');
const pool = require('./db');

// The app says the same few sentences over and over ("Logged $700 income, sales."). Only the
// amount changes, so translating each one with Gemini on the spot would make the owner wait
// several seconds every time. Instead we translate the words once per language (type,
// category and the sentence frames), keep them in memory, and put the amount in ourselves.

const ENGLISH = {
  logged: 'Logged',
  income: 'income',
  expense: 'expense',
  sales: 'sales',
  supplies: 'supplies',
  rent: 'rent',
  payroll: 'payroll',
  equipment: 'equipment',
  loan_payment: 'loan payment',
  other: 'other',
  added_one: 'Added 1 entry to your ledger.',
  added_many: 'Added {n} entries to your ledger.',
};
const KEYS = Object.keys(ENGLISH);

const books = new Map(); // language code -> Promise<phrasebook | null>

async function buildPhrasebook(code) {
  const language = find(code);
  try {
    const response = await generate({
      contents: `Translate each value of this JSON into ${language.name} for short spoken confirmations to a small business owner. Keep the text {n} exactly as it is. Keep it brief and natural. Reply with the JSON only.\n\n${JSON.stringify(ENGLISH)}`,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: Object.fromEntries(KEYS.map((k) => [k, { type: 'STRING' }])),
          required: KEYS,
        },
      },
    });
    const book = JSON.parse(response.text);
    const complete = KEYS.every((k) => typeof book[k] === 'string' && book[k].trim());
    if (!complete || !book.added_many.includes('{n}')) throw new Error('incomplete translation');
    return book;
  } catch (err) {
    console.error(`[phrasebook] ${code} failed:`, err.status || err.message?.slice(0, 120));
    return null;
  }
}

function getPhrasebook(code) {
  if (!books.has(code)) {
    const pending = buildPhrasebook(code).then((book) => {
      if (!book) books.delete(code); // try again next time
      return book;
    });
    books.set(code, pending);
  }
  return books.get(code);
}

// Start translating in the background, e.g. when the owner picks a language
function warmPhrasebook(code) {
  if (code !== 'en' && find(code)) void getPhrasebook(code);
}

// On startup, warm the languages people have chosen, so the first confirmation is not slow
async function warmChosenLanguages() {
  try {
    const result = await pool.query("SELECT DISTINCT value FROM settings WHERE key = 'language'");
    result.rows.forEach((r) => warmPhrasebook(r.value));
  } catch (err) {
    console.error('[phrasebook] startup warm-up failed:', err.message);
  }
}

// If the English line is one of the app's fixed sentences, return it in the owner's
// language; otherwise return null so the caller translates it normally.
async function localizeKnownLine(text, code) {
  if (code === 'en') return null;

  const logged = text.match(/^Logged \$([\d,]+(?:\.\d+)?) (income|expense), ([a-z ]+)\.$/);
  const added = text.match(/^Added (\d+) (?:entry|entries) to your ledger\.$/);
  if (!logged && !added) return null;

  const book = await getPhrasebook(code);
  if (!book) return null;

  if (logged) {
    const [, amount, type, category] = logged;
    const word = book[category.replaceAll(' ', '_')];
    if (!word) return null;
    return { text: `${book.logged} $${amount} ${book[type]}, ${word}.`, language: code };
  }
  const n = Number(added[1]);
  return { text: n === 1 ? book.added_one : book.added_many.replace('{n}', String(n)), language: code };
}

module.exports = { localizeKnownLine, warmPhrasebook, warmChosenLanguages };
