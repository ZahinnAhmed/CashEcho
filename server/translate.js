const { generate } = require('./gemini');
const { find } = require('./languages');

// Turns a short English sentence into the owner's language so it can be spoken aloud.
// Numbers are the part that must never go wrong, so the translation is only used if every
// number from the English sentence appears unchanged in it. Otherwise the English is spoken.
const cache = new Map();

// Some languages write digits in their own script (Bengali ৫, Hindi ५, Arabic ٥ ...). Turn them
// back into 0-9 so the safety check below can compare them with the English numbers.
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0be6, 0xff10]; // where each script's zero starts
function normalizeDigits(text) {
  return text.replace(/\p{Nd}/gu, (ch) => {
    const code = ch.codePointAt(0);
    const zero = DIGIT_BLOCKS.find((z) => code >= z && code < z + 10);
    return zero === undefined ? ch : String(code - zero);
  });
}

// "5,500" and "5500" are the same amount, so ignore thousands commas when comparing
const flat = (s) => s.replace(/(\d),(?=\d)/g, '$1');
const numbersIn = (s) => s.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [];

async function translateForSpeech(text, code) {
  const language = find(code);
  if (!language || code === 'en') return { text, language: 'en' };

  const key = `${code}|${text}`;
  if (cache.has(key)) return cache.get(key);

  let result = { text, language: 'en' };
  const mustKeep = numbersIn(text);
  try {
    // Two tries: if a number comes back changed, ask again with the exact numbers listed
    for (let attempt = 0; attempt < 2 && result.language === 'en'; attempt++) {
      const response = await generate({
        contents: `Translate this short message into ${language.name} so it can be read aloud to a small business owner. Keep every number, dollar amount and percentage exactly as digits (for example $5,500 or 95%). Keep lender and business names unchanged. Use a warm, plain, spoken style. Reply with the translation only, no quotes and no notes.${attempt ? `\nThese numbers must appear exactly as written, unchanged: ${mustKeep.join(', ')}.` : ''}

Message: ${text}`,
        config: { temperature: 0 },
      });
      const translated = normalizeDigits((response.text || '').trim().replace(/^["“]|["”]$/g, ''));
      const missing = mustKeep.filter((n) => !flat(translated).includes(flat(n)));
      if (translated && !missing.length) {
        result = { text: translated, language: code };
      } else {
        console.error(`[translate] ${code}: attempt ${attempt + 1} changed ${JSON.stringify(missing)}`);
      }
    }
    if (result.language === 'en') console.error(`[translate] ${code}: speaking English instead`);
  } catch (err) {
    console.error('[translate] failed, speaking English instead:', err.status || err.message?.slice(0, 120));
  }

  // Remember good translations; a failure is retried next time
  if (result.language === code) cache.set(key, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { translateForSpeech };
