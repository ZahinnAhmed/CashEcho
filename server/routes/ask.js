const express = require('express');
const { generate } = require('../gemini');
const { runTool, setBudget, PERIODS, CATEGORIES, TOOLS, money } = require('../assistant');

const router = express.Router();

// One door for everything the owner says. Is it a sale or payment to log ("Paid $340 for flour")
// or a question about their own numbers ("How much did we spend last week?")? Logging goes to the
// existing parse and confirm flow. Questions are answered from real data by assistant.js, and if
// something is missing (like a budget) the assistant asks for it and remembers the answer.

const QUESTION_START = /^(how|what|when|which|who|where|why|do|does|did|can|could|should|am|are|is|will|have|has|tell|show|give|set|change)\b/i;
const QUESTION_WORDS = /\b(budget|how much|how many|what|when|left|remaining|afford)\b/i;

// A quick check so plain entries like "Paid $340 for flour" skip the classifier (faster, and
// saves a Gemini request). Anything unsure goes to the classifier.
const PERIOD_WORDS = /\b(this week|last week|all week|the week|this month|last month|past (week|few days)|last \d+ days|since (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|so far)\b/i;
const manyAmounts = (text) => (text.match(/\d[\d,]*(?:\.\d+)?/g) || []).length >= 3;

function looksLikeLog(text) {
  if (PERIOD_WORDS.test(text) || manyAmounts(text)) return false; // a whole stretch, not one entry
  return /\d/.test(text) && !text.includes('?') && !QUESTION_START.test(text.trim()) && !QUESTION_WORDS.test(text);
}

const schema = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['log', 'catchup', 'question', 'unclear'] },
    tool: { type: 'STRING', enum: [...TOOLS, 'none'] },
    period: { type: 'STRING', enum: PERIODS },
    category: { type: 'STRING', enum: [...CATEGORIES, 'none'] },
    amount: { type: 'NUMBER', nullable: true },
  },
  required: ['intent', 'tool', 'period', 'category'],
};

function classifyPrompt(text) {
  return `A small business owner is talking to their bookkeeping app. They may speak any language. Decide what they said and answer in English using only the allowed values.

intent:
- "log": they are telling you about a sale or a payment to record, for example "Paid 340 for flour" or "Sold 40 gyros".
- "catchup": they are summing up a whole stretch of time (a week, several days, a month) with one or more totals, for example "this week we sold 3200 and spent 1900 on supplies".
- "question": they are asking about their own numbers.
- "unclear": anything else.

For a question, choose tool:
- spend_total: how much was spent. income_total: how much came in or was earned. profit: how much they made or kept.
- spend_by_category: spending on something, or what the biggest cost is (set category if they name one).
- top_vendor: who they spend the most with.
- cash_on_hand: how much cash or money they have now.
- next_payment: what loan payment is due next.
- shortfall_risk: whether they will run short of cash, or can cover their payments.
- debt_coverage: how well their income covers their loans.
- budget_remaining: whether they have budget left, or can afford to order or buy more this month.
- set_budget: they are telling you their budget (put the dollar amount in amount).
Use "none" if it is not a question.

period: the time they mean ("last week", "this month", "yesterday"...). If they do not say, use last_7_days.
category: only for spending on one named kind of cost, otherwise "none".

They said: "${text}"`;
}

// "5000", "$5,000", "5k". Words ("five thousand") are left to Gemini.
function amountFromDigits(text) {
  const k = text.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1]) * 1000);
  const m = text.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// A budget answer is short and is just an amount ("5000", "it's about 5k"). If the owner said
// something that sounds like a sale or expense, it is NOT an answer to the budget question.
const LOG_WORDS = /\b(earn|earned|earning|sold|sale|sales|paid|pay|bought|spent|spend|received|made|income|expense|revenue|tips?)\b/i;
const looksLikeBudgetAnswer = (text) => text.split(/\s+/).length <= 8 && !LOG_WORDS.test(text);

async function extractAmount(text) {
  const direct = amountFromDigits(text);
  if (direct) return direct;
  try {
    const response = await generate(
      {
        contents: `What dollar amount did the person say? Reply with the number only (for example 5000 for "five thousand dollars"), or null if there is no amount.\n\n"${text}"`,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: { amount: { type: 'NUMBER', nullable: true } }, required: ['amount'] },
        },
      },
      { prefer: 'lite' }
    );
    const amount = JSON.parse(response.text).amount;
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 500) return res.status(400).json({ error: 'text is too long' });
  const userId = req.user.id;

  try {
    // The assistant asked for the budget last time; this should be the answer
    if (req.body.pending?.slot === 'monthly_budget' && looksLikeBudgetAnswer(text)) {
      const amount = await extractAmount(text);
      if (amount) {
        await setBudget(userId, amount);
        const done = await runTool(userId, 'budget_remaining');
        return res.json({ type: 'answer', text: `Got it, your monthly budget is ${money(amount)}. ${done.text}` });
      }
      // No amount in it: treat it as a new request instead of getting stuck
    }

    if (looksLikeLog(text)) return res.json({ type: 'log' });

    const response = await generate(
      { contents: classifyPrompt(text), config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } },
      { prefer: 'lite' }
    );
    const c = JSON.parse(response.text);

    if (c.intent === 'log') return res.json({ type: 'log' });
    if (c.intent === 'catchup') return res.json({ type: 'catchup' });
    if (c.intent === 'question' && TOOLS.includes(c.tool)) {
      return res.json(await runTool(userId, c.tool, { period: c.period, category: c.category, amount: c.amount }));
    }
    res.json(await runTool(userId, 'none'));
  } catch (err) {
    console.error('[ask] failed:', err.status || '', err.message?.slice(0, 160));
    if (err.status === 429) return res.status(429).json({ error: 'The assistant is busy. Please try again in a minute.' });
    res.status(502).json({ error: "Sorry, I couldn't work that out. Try asking another way." });
  }
});

module.exports = router;
