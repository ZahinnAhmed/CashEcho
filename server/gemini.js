require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { GoogleGenAI } = require('@google/genai');

// Shared Gemini client, used by parsing, the alert, imports and translation
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-2.5-flash';

// Each model has its own daily limit on the free tier, so when one is used up (429), busy (503)
// or retired (404) we move to the next one instead of failing in front of the user.
const MODELS = [MODEL, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const COOLDOWN_MS = { 429: 5 * 60 * 1000, 404: 60 * 60 * 1000 };
const skipUntil = new Map(); // model -> time before which we do not try it again

// Same as ai.models.generateContent, but without the `model` field: it picks one for you.
// { prefer: 'lite' } tries the small, fast models first (good for simple classification).
// Each attempt gets at most `attemptMs`, and all attempts together at most `totalMs`: a model
// that hangs counts as busy, so we move on instead of keeping the owner waiting for minutes.
// { fast: true } turns off 2.5 Flash's "thinking" step, which made reading a receipt photo about
// three times slower (6 s vs 2 s) with the same result. Only 2.5 Flash is sent this setting.
async function generate(request, { prefer, fast, attemptMs = 25000, totalMs = 45000 } = {}) {
  let lastError;
  const deadline = Date.now() + totalMs;
  const order =
    prefer === 'lite'
      ? [...MODELS.filter((m) => m.includes('lite')), ...MODELS.filter((m) => !m.includes('lite'))]
      : MODELS;
  for (const model of order) {
    if ((skipUntil.get(model) || 0) > Date.now()) continue;
    const timeLeft = deadline - Date.now();
    if (timeLeft < 2000) break;
    try {
      return await ai.models.generateContent({
        ...request,
        model,
        config: {
          ...request.config,
          ...(fast && model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          abortSignal: AbortSignal.timeout(Math.min(attemptMs, timeLeft)),
        },
      });
    } catch (err) {
      lastError = err;
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      if (timedOut) {
        console.error(`[gemini] ${model} took too long, trying the next model`);
        continue;
      }
      if (![429, 503, 404].includes(err.status)) throw err; // a real error, not capacity
      if (COOLDOWN_MS[err.status]) skipUntil.set(model, Date.now() + COOLDOWN_MS[err.status]);
    }
  }
  throw Object.assign(new Error('Every Gemini model is busy right now'), { status: 429, cause: lastError });
}

module.exports = { ai, MODEL, generate };
