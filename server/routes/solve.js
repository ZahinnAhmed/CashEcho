const express = require('express');
const { loadWallInputs, forecast } = require('./wall');

const router = express.Router();

// "How do I fix it?" Finds the smallest change that brings the chance of running out of cash down
// to a target, by trying "what if" versions of the same forecast (same random draws each time,
// so the only difference is the change being tested). It looks for three kinds of fix:
//   1. have more cash in the bank at the start
//   2. move the balloon payment later
//   3. bring in (or save) more every day

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pctOf = (p) => `${Math.round(p * 100)}%`;
const prettyDate = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// Smallest value in (0, max] that makes `works(value)` true, for a `works` that only gets easier
// as the value grows. Returns null if even `max` is not enough.
function smallestThatWorks(works, max, steps = 12) {
  if (!works(max)) return null;
  let low = 0;
  let high = max;
  for (let i = 0; i < steps; i++) {
    const mid = (low + high) / 2;
    if (works(mid)) high = mid;
    else low = mid;
  }
  return high;
}

router.get('/', async (req, res) => {
  try {
    const target = Math.min(0.5, Math.max(0.05, Number(req.query.target) || 0.2));
    const inputs = await loadWallInputs(req.user.id);
    const base = forecast(inputs);

    if (base.shortfall_probability == null) {
      return res.json({ status: 'not_enough_data', options: [] });
    }
    if (base.shortfall_probability <= target) {
      return res.json({ status: 'ok', target, current_probability: base.shortfall_probability, options: [] });
    }

    const probability = (changes) => forecast(inputs, changes).shortfall_probability;
    const works = (changes) => probability(changes) <= target;
    const options = [];
    const shortfall = base.first_shortfall;
    const totalDue = base.payments.reduce((n, p) => n + p.amount, 0);

    // 1. More cash in the bank
    const cash = smallestThatWorks((x) => works({ extraCash: x }), Math.max(totalDue, 1000));
    if (cash != null) {
      const amount = Math.ceil(cash / 50) * 50; // round up to the next $50, then confirm it works
      const result = probability({ extraCash: amount });
      options.push({
        id: 'cash',
        title: `Have ${money(amount)} more in the bank`,
        detail: `Starting with ${money(amount)} extra cash${shortfall ? ` before ${prettyDate(new Date(`${shortfall.due_date}T12:00:00`))}` : ''} brings the chance of running short from ${pctOf(base.shortfall_probability)} to about ${pctOf(result)}.`,
        amount,
        resulting_probability: result,
      });
    }

    // 2. Move the balloon payment later (in whole weeks)
    const balloon =
      inputs.debts.find((d) => shortfall && d.id === shortfall.debt_id && Number(d.balloon_amount) > 0) ||
      inputs.debts.find((d) => Number(d.balloon_amount) > 0 && d.balloon_date);
    if (balloon) {
      const weeks = smallestThatWorks((w) => works({ balloonShiftDays: Math.round(w) * 7 }), 40, 6);
      if (weeks != null) {
        const days = Math.max(1, Math.round(weeks)) * 7;
        const result = probability({ balloonShiftDays: days });
        const from = new Date(balloon.balloon_date);
        options.push({
          id: 'balloon',
          title: `Ask ${balloon.lender} to move the ${money(balloon.balloon_amount)} balloon to ${prettyDate(addDays(from, days))}`,
          detail: `That is ${days / 7} ${days / 7 === 1 ? 'week' : 'weeks'} later than ${prettyDate(from)}. The chance of running short would drop from ${pctOf(base.shortfall_probability)} to about ${pctOf(result)}.`,
          days,
          resulting_probability: result,
        });
      }
    }

    // 3. Bring in (or save) more every day
    const daily = smallestThatWorks((x) => works({ dailyNetDelta: x }), 500);
    if (daily != null) {
      const perDay = Math.max(5, Math.ceil(daily / 5) * 5); // round up to the next $5
      const result = probability({ dailyNetDelta: perDay });
      options.push({
        id: 'daily',
        title: `Bring in or save ${money(perDay)} more every day`,
        detail: `About ${money(perDay * 30)} a month, from higher sales or lower costs. The chance of running short would drop from ${pctOf(base.shortfall_probability)} to about ${pctOf(result)}.`,
        per_day: perDay,
        resulting_probability: result,
      });
    }

    res.json({ status: 'needs_action', target, current_probability: base.shortfall_probability, options });
  } catch (err) {
    console.error('[solve] failed:', err.message);
    res.status(500).json({ error: 'solve_failed' });
  }
});

module.exports = router;
