const pool = require('./db');
const { computeWall } = require('./routes/wall');

// The lookups the voice assistant can run. Gemini only chooses WHICH lookup and its settings
// (see routes/ask.js); every number here comes from the owner's own data through fixed,
// parameterized queries, and every sentence is built from those numbers. Gemini never writes
// SQL and never does the arithmetic.

const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days'];
const CATEGORIES = ['sales', 'supplies', 'rent', 'payroll', 'equipment', 'loan_payment', 'other'];
const TOOLS = [
  'spend_total', 'income_total', 'profit', 'spend_by_category', 'top_vendor',
  'cash_on_hand', 'next_payment', 'shortfall_risk', 'debt_coverage', 'budget_remaining', 'set_budget',
];

const money = (n) => {
  const x = Math.abs(n);
  const text = x >= 10 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2).replace(/\.00$/, '');
  return `${n < 0 ? '-' : ''}$${text}`;
};
const prettyDate = (key) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

// ---- Dates (the cart's calendar day in New York, as 'YYYY-MM-DD') ----
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const shift = (key, days) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (key) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

function periodRange(period) {
  const today = todayKey();
  const monday = shift(today, -weekday(today));
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (period) {
    case 'today': return { from: today, to: today, label: 'today' };
    case 'yesterday': return { from: shift(today, -1), to: shift(today, -1), label: 'yesterday' };
    case 'this_week': return { from: monday, to: today, label: 'this week' };
    case 'last_week': return { from: shift(monday, -7), to: shift(monday, -1), label: 'last week' };
    case 'this_month': return { from: firstOfMonth, to: today, label: 'this month' };
    case 'last_month': {
      const lastDay = shift(firstOfMonth, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay, label: 'last month' };
    }
    case 'last_7_days': return { from: shift(today, -6), to: today, label: 'in the last 7 days' };
    case 'last_30_days': return { from: shift(today, -29), to: today, label: 'in the last 30 days' };
    default: return { from: shift(today, -6), to: today, label: 'in the last 7 days' };
  }
}

const RANGE_DAILY = `day >= $2::date::timestamp AT TIME ZONE 'UTC' AND day < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'`;
const RANGE_RAW = `occurred_at >= $2::date::timestamp AT TIME ZONE 'UTC' AND occurred_at < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'`;

// Totals for a period, read from the daily_totals aggregate
async function totals(userId, range) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(income), 0) AS income, COALESCE(SUM(expenses), 0) AS expenses,
            COALESCE(SUM(income) - SUM(net_excl_loans), 0) AS operating_expenses
     FROM daily_totals WHERE user_id = $1 AND ${RANGE_DAILY}`,
    [userId, range.from, range.to]
  );
  const row = r.rows[0];
  const count = (await pool.query(
    `SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND ${RANGE_RAW}`, [userId, range.from, range.to]
  )).rows[0].n;
  return { income: Number(row.income), expenses: Number(row.expenses), operating: Number(row.operating_expenses), count: Number(count) };
}

async function getBudget(userId) {
  const r = await pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'monthly_budget'", [userId]);
  return r.rows[0] ? Number(r.rows[0].value) : null;
}
async function setBudget(userId, amount) {
  await pool.query(
    `INSERT INTO settings (user_id, key, value) VALUES ($1, 'monthly_budget', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, String(amount)]
  );
}

async function budgetAnswer(userId, budget) {
  const range = periodRange('this_month');
  const spent = (await totals(userId, range)).operating; // everything except loan payments
  const left = budget - spent;
  return left >= 0
    ? `You've spent ${money(spent)} of your ${money(budget)} budget this month, so you have ${money(left)} left. Anything above that would have to wait until next month.`
    : `You've spent ${money(spent)} this month, which is ${money(-left)} over your ${money(budget)} budget.`;
}

// Runs one lookup. Returns { type: 'answer', text } or { type: 'ask', text, pending } when it
// needs something from the owner first.
async function runTool(userId, tool, params = {}) {
  const range = periodRange(params.period);
  const none = (what) => ({ type: 'answer', text: `I don't see any ${what} ${range.label}.` });

  switch (tool) {
    case 'spend_total': {
      const t = await totals(userId, range);
      if (!t.count) return none('entries');
      const loans = t.expenses - t.operating;
      return { type: 'answer', text: `You spent ${money(t.expenses)} ${range.label}${loans > 0.5 ? `, including ${money(loans)} in loan payments` : ''}.` };
    }
    case 'income_total': {
      const t = await totals(userId, range);
      if (!t.count) return none('entries');
      return { type: 'answer', text: `You brought in ${money(t.income)} ${range.label}.` };
    }
    case 'profit': {
      const t = await totals(userId, range);
      if (!t.count) return none('entries');
      const net = t.income - t.expenses;
      return { type: 'answer', text: `${range.label[0].toUpperCase()}${range.label.slice(1)} you brought in ${money(t.income)} and spent ${money(t.expenses)}, so you ${net >= 0 ? 'came out ahead by' : 'were short by'} ${money(Math.abs(net))}.` };
    }
    case 'spend_by_category': {
      const r = await pool.query(
        `SELECT category, SUM(amount) AS amount FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND ${RANGE_RAW}
         GROUP BY category ORDER BY amount DESC`,
        [userId, range.from, range.to]
      );
      if (!r.rows.length) return none('spending');
      const total = r.rows.reduce((n, x) => n + Number(x.amount), 0);
      const label = (c) => c.replaceAll('_', ' ');
      if (CATEGORIES.includes(params.category)) {
        const row = r.rows.find((x) => x.category === params.category);
        return { type: 'answer', text: row ? `You spent ${money(Number(row.amount))} on ${label(params.category)} ${range.label}.` : `You didn't spend anything on ${label(params.category)} ${range.label}.` };
      }
      const top = r.rows[0];
      return { type: 'answer', text: `Most of your spending ${range.label} went to ${label(top.category)}: ${money(Number(top.amount))} out of ${money(total)}.` };
    }
    case 'top_vendor': {
      const r = await pool.query(
        `SELECT vendor, SUM(amount) AS amount FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND vendor IS NOT NULL AND ${RANGE_RAW}
         GROUP BY vendor ORDER BY amount DESC LIMIT 1`,
        [userId, range.from, range.to]
      );
      if (!r.rows.length) return none('purchases with a vendor');
      return { type: 'answer', text: `You spent the most at ${r.rows[0].vendor} ${range.label}: ${money(Number(r.rows[0].amount))}.` };
    }
    case 'cash_on_hand': {
      const w = await computeWall(userId);
      return { type: 'answer', text: `You have ${money(w.starting_cash)} in cash right now, based on what you've logged.` };
    }
    case 'next_payment': {
      const w = await computeWall(userId);
      const p = w.payments[0];
      if (!p) return { type: 'answer', text: 'You have no loan payments coming up in the next 90 days.' };
      const what = p.kind === 'daily' ? `${p.count} daily payments totaling ${money(p.amount)}` : `a ${money(p.amount)} payment`;
      return { type: 'answer', text: `Your next loan payment is ${what} to ${p.lender}, starting ${prettyDate(p.due_date)}.` };
    }
    case 'shortfall_risk': {
      const w = await computeWall(userId);
      const s = w.first_shortfall;
      if (!s) return { type: 'answer', text: 'Your cash covers every scheduled loan payment over the next 90 days.' };
      const chance = s.probability != null ? ` The chance of running short by then is about ${Math.round(s.probability * 100)} percent.` : '';
      return { type: 'answer', text: `Your ${money(s.amount)} payment to ${s.lender} on ${prettyDate(s.due_date)} is projected to leave you about ${money(s.shortfall)} short.${chance}` };
    }
    case 'debt_coverage': {
      const w = await computeWall(userId);
      if (w.coverage.ratio == null) return { type: 'answer', text: "You haven't added any loans yet." };
      const r = w.coverage.ratio;
      return { type: 'answer', text: `Each month your business brings in about ${money(w.coverage.monthly_operating_cash)} before loan payments, against ${money(w.coverage.monthly_loan_payments)} of payments. That's ${r.toFixed(1)} times, and lenders often look for 1.25 or more.` };
    }
    case 'budget_remaining': {
      const budget = await getBudget(userId);
      if (budget == null) {
        return {
          type: 'ask',
          text: "You haven't told me your budget yet. What's your budget for this month?",
          pending: { slot: 'monthly_budget', tool: 'budget_remaining' },
        };
      }
      return { type: 'answer', text: await budgetAnswer(userId, budget) };
    }
    case 'set_budget': {
      const amount = Number(params.amount);
      if (!(amount > 0)) {
        return { type: 'ask', text: 'What would you like your monthly budget to be?', pending: { slot: 'monthly_budget', tool: 'set_budget' } };
      }
      await setBudget(userId, amount);
      return { type: 'answer', text: `Got it. Your monthly budget is ${money(amount)}. ${await budgetAnswer(userId, amount)}` };
    }
    default:
      return { type: 'unclear', text: "I can log a sale or an expense, or answer questions about your spending, income, cash, budget and loan payments." };
  }
}

module.exports = { runTool, setBudget, PERIODS, CATEGORIES, TOOLS, money };
