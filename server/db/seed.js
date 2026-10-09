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

function buildTransactions(today) {
  const rows = [];
  for (let i = 90; i >= 1; i--) {
    const date = dateKey(addDays(today, -i));
    rows.push({ date, type: 'income', amount: 410 + (i % 7) * 17, category: 'sales',
      vendor: 'Daily cart sales', payment_method: 'cash', note: 'Lunch service' });
    rows.push({ date, type: 'expense', amount: 300 + (i % 5) * 13, category: 'supplies',
      vendor: 'Restaurant Depot', payment_method: 'card', note: 'Ingredients and packaging' });
    if (i % 7 === 0) {
      rows.push({ date, type: 'expense', amount: 480, category: 'payroll',
        vendor: 'Weekly payroll', payment_method: 'other', note: 'Cart assistant' });
    }
  }
  return rows;
}

function buildDebts(today) {
  return [
    { lender: 'SBA business loan', kind: 'SBA', balance: 25000, monthly_payment: 520, rate_pct: 8,
      payment_day: 5, end_date: dateKey(addDays(today, 1000)), balloon_amount: null, balloon_date: null },
    { lender: 'Cart equipment financing', kind: 'Equipment', balance: 6000, monthly_payment: 280, rate_pct: 10,
      payment_day: 15, end_date: dateKey(addDays(today, 44)),
      balloon_amount: 5500, balloon_date: dateKey(addDays(today, 35)) },
    { lender: 'Merchant cash advance', kind: 'MCA', balance: 8000, monthly_payment: 800, rate_pct: 0,
      payment_day: 22, end_date: dateKey(addDays(today, 300)), balloon_amount: null, balloon_date: null },
  ];
}

// Monthly payments from today until end_date (day clamped to month end), plus the balloon.
function buildPayments(debt, today) {
  const payments = [];
  const end = new Date(`${debt.end_date}T00:00:00`);
  for (let m = 0; ; m++) {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + m + 1, 0).getDate();
    const due = new Date(today.getFullYear(), today.getMonth() + m, Math.min(debt.payment_day, lastDay));
    if (due > end) break;
    if (due >= today) payments.push({ due_date: dateKey(due), amount: debt.monthly_payment });
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
           (lender, kind, balance, monthly_payment, rate_pct, payment_day, end_date, balloon_amount, balloon_date, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [debt.lender, debt.kind, debt.balance, debt.monthly_payment, debt.rate_pct,
         debt.payment_day, debt.end_date, debt.balloon_amount, debt.balloon_date, user.id]
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
