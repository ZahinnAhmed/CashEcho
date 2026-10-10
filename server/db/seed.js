// Fills the database with demo data: a food cart with 90 days of sales and expenses,
// plus three loans, one of them with a balloon payment that causes a shortfall.
// Same data as the frontend's demo mode (client/src/demo.js).
//
// The data is created for one user, identified by their Google email:
//   node db/seed.js you@gmail.com           seeds only if that user has no data yet
//   node db/seed.js you@gmail.com --reset   deletes THAT user's transactions and debts first, then seeds
const pool = require('./index');
const { saveUser } = require('../auth');

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const DEMO_CASH = 2400;

// Small seeded random generator: every run makes the same "random" pattern
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A food cart's ordinary ups and downs, so the forecast shows a real range instead of a
// straight line: Fridays and weekends sell more, about one day in eight is rained out,
// every day is a little different, and supply runs vary with what was bought.
const WEEKDAY_SALES = [1.15, 0.8, 0.85, 0.9, 1.0, 1.2, 1.3]; // Sunday to Saturday

function buildTransactions(today) {
  const rand = mulberry32(2026);
  const rows = [];
  for (let i = 90; i >= 1; i--) {
    const day = addDays(today, -i);
    const date = dateKey(day);
    const rained = rand() < 0.12;
    const sales = 520 * WEEKDAY_SALES[day.getDay()] * (rained ? 0.45 : 1) * (0.85 + rand() * 0.3);
    rows.push({ date, type: 'income', amount: Math.round(sales), category: 'sales',
      vendor: 'Daily cart sales', payment_method: rand() < 0.35 ? 'card' : 'cash',
      note: rained ? 'Rainy, slow service' : 'Lunch service' });

    // Supplies are bought in uneven runs, a little less on slow days
    const supplies = (230 + rand() * 180) * (rained ? 0.8 : 1);
    rows.push({ date, type: 'expense', amount: Math.round(supplies), category: 'supplies',
      vendor: rand() < 0.75 ? 'Restaurant Depot' : 'Jetro', payment_method: 'card',
      note: 'Ingredients and packaging' });

    if (day.getDay() === 5) {
      rows.push({ date, type: 'expense', amount: 480, category: 'payroll',
        vendor: 'Weekly payroll', payment_method: 'other', note: 'Cart assistant' });
    }
  }
  return rows;
}

function buildDebts(today) {
  return [
    { lender: 'SBA business loan', kind: 'SBA', balance: 25000, monthly_payment: 520, rate_pct: 8,
      payment_frequency: 'monthly', payment_weekday: null,
      payment_day: 5, end_date: dateKey(addDays(today, 1000)), balloon_amount: null, balloon_date: null },
    { lender: 'Cart equipment financing', kind: 'Equipment', balance: 6000, monthly_payment: 280, rate_pct: 10,
      payment_frequency: 'monthly', payment_weekday: null,
      payment_day: 15, end_date: dateKey(addDays(today, 44)),
      balloon_amount: 5500, balloon_date: dateKey(addDays(today, 35)) },
    { lender: 'Merchant cash advance', kind: 'MCA', balance: 8000, monthly_payment: 38, rate_pct: 0,
      // An advance like this is usually paid back by a fixed debit every business day
      payment_frequency: 'daily', payment_weekday: null,
      payment_day: null, end_date: dateKey(addDays(today, 300)), balloon_amount: null, balloon_date: null },
  ];
}

// Monthly payments from today until end_date (day clamped to month end), plus the balloon.
function buildPayments(debt, today) {
  const payments = [];
  const end = new Date(`${debt.end_date}T00:00:00`);
  if (debt.payment_frequency === 'daily') {
    // Every business day (Monday to Friday) until the end date, at most 400 rows
    for (let d = new Date(today); d <= end && payments.length < 400; d.setDate(d.getDate() + 1)) {
      if (d.getDay() >= 1 && d.getDay() <= 5) payments.push({ due_date: dateKey(d), amount: debt.monthly_payment });
    }
  } else {
    // Monthly: on the payment day (the last day of short months) until the end date
    for (let m = 0; ; m++) {
      const lastDay = new Date(today.getFullYear(), today.getMonth() + m + 1, 0).getDate();
      const due = new Date(today.getFullYear(), today.getMonth() + m, Math.min(debt.payment_day, lastDay));
      if (due > end) break;
      if (due >= today) payments.push({ due_date: dateKey(due), amount: debt.monthly_payment });
    }
  }
  if (debt.balloon_amount) payments.push({ due_date: debt.balloon_date, amount: debt.balloon_amount });
  return payments;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const email = process.argv.slice(2).find((a) => a.includes('@'));
  if (!email) {
    console.error('Usage: node db/seed.js you@gmail.com [--reset]');
    process.exit(1);
  }
  const user = await saveUser({ email, name: email, picture: null }); // keeps their name if they already signed in
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT (SELECT count(*) FROM transactions WHERE user_id = $1) AS t,
              (SELECT count(*) FROM debts WHERE user_id = $1) AS d`,
      [user.id]
    );
    const { t, d } = existing.rows[0];
    if (Number(t) + Number(d) > 0) {
      if (!reset) {
        console.log(`${email} already has ${t} transactions and ${d} debts. Run with --reset to replace them.`);
        await client.query('ROLLBACK');
        return;
      }
      await client.query('DELETE FROM debts WHERE user_id = $1', [user.id]); // debt_payments go with them (ON DELETE CASCADE)
      await client.query('DELETE FROM transactions WHERE user_id = $1', [user.id]);
    }

    const seedTransactions = buildTransactions(today);

    for (const tx of seedTransactions) {
      await client.query(
        `INSERT INTO transactions (user_id, occurred_at, type, amount, category, vendor, payment_method, note)
         VALUES ($8, ($1::date + interval '12 hours') AT TIME ZONE 'UTC', $2, $3, $4, $5, $6, $7)`,
        [tx.date, tx.type, tx.amount, tx.category, tx.vendor, tx.payment_method, tx.note, user.id]
      );
    }

    for (const debt of buildDebts(today)) {
      const result = await client.query(
        `INSERT INTO debts
           (lender, kind, balance, monthly_payment, rate_pct, payment_day, end_date, balloon_amount, balloon_date, user_id,
            payment_frequency, payment_weekday)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [debt.lender, debt.kind, debt.balance, debt.monthly_payment, debt.rate_pct,
         debt.payment_day, debt.end_date, debt.balloon_amount, debt.balloon_date, user.id,
         debt.payment_frequency, debt.payment_weekday]
      );
      for (const p of buildPayments(debt, today)) {
        await client.query(
          'INSERT INTO debt_payments (debt_id, due_date, amount) VALUES ($1, $2, $3)',
          [result.rows[0].id, p.due_date, p.amount]
        );
      }
    }

    // Set the opening balance so cash on hand today is $2,400 (the demo story: a balloon payment is coming)
    const net = seedTransactions.reduce((n, t) => n + (t.type === 'income' ? t.amount : -t.amount), 0);
    await client.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, 'opening_cash', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [user.id, String(DEMO_CASH - net)]
    );

    await client.query('COMMIT');
    await pool.query("CALL refresh_continuous_aggregate('daily_totals', NULL, NULL)");
    console.log(`Seeded 3 debts and 90 days of transactions for ${email}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
