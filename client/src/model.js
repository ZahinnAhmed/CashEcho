export const categories = [
  "sales",
  "supplies",
  "rent",
  "payroll",
  "equipment",
  "loan_payment",
  "other",
];
export const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDate = (s) => new Date(`${s}T12:00:00`);
export const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};
export const prettyDate = (s) =>
  parseDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export function validateTransaction(t) {
  if (!["income", "expense"].includes(t.type))
    throw new Error("Choose income or expense.");
  if (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0)
    throw new Error("Enter an amount greater than zero.");
  if (!categories.includes(t.category))
    throw new Error("Choose a valid category.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
    dateKey(parseDate(t.date)) !== t.date
  )
    throw new Error("Enter a valid date.");
  if (!["cash", "card", "other"].includes(t.payment_method))
    throw new Error("Choose a payment method.");
  return { ...t, amount: Math.round(Number(t.amount) * 100) / 100 };
}
export function validateDebt(d) {
  if (!d.lender?.trim()) throw new Error("Enter the lender name.");
  for (const k of ["balance", "monthly_payment", "rate_pct", "balloon_amount"])
    if (!Number.isFinite(Number(d[k])) || Number(d[k]) < 0)
      throw new Error("Loan amounts and rate must be zero or greater.");
  if (Number(d.monthly_payment) === 0 && Number(d.balloon_amount) === 0)
    throw new Error("Add a monthly payment or a balloon payment.");
  if (
    !Number.isInteger(Number(d.payment_day)) ||
    Number(d.payment_day) < 1 ||
    Number(d.payment_day) > 31
  )
    throw new Error("Payment day must be 1–31.");
  if (!d.end_date || dateKey(parseDate(d.end_date)) !== d.end_date)
    throw new Error("Enter a valid end date.");
  if (
    Number(d.balloon_amount) > 0 &&
    (!d.balloon_date ||
      dateKey(parseDate(d.balloon_date)) !== d.balloon_date ||
      d.balloon_date > d.end_date)
  )
    throw new Error(
      "Balloon date must be valid and no later than the end date.",
    );
  return {
    ...d,
    lender: d.lender.trim(),
    ...Object.fromEntries(
      [
        "balance",
        "monthly_payment",
        "rate_pct",
        "payment_day",
        "balloon_amount",
      ].map((k) => [k, Number(d[k])]),
    ),
  };
}
export function schedulePayments(debts, start, horizon = 90) {
  const end = addDays(start, horizon - 1),
    rows = [];
  for (const debt of debts) {
    for (let offset = 0; offset < 4; offset++) {
      const month = new Date(
        start.getFullYear(),
        start.getMonth() + offset,
        1,
        12,
      );
      const lastDay = new Date(
        month.getFullYear(),
        month.getMonth() + 1,
        0,
      ).getDate();
      const due = new Date(
        month.getFullYear(),
        month.getMonth(),
        Math.min(Number(debt.payment_day), lastDay),
        12,
      );
      const key = dateKey(due);
      if (
        key >= dateKey(start) &&
        key <= dateKey(end) &&
        key <= debt.end_date &&
        Number(debt.monthly_payment) > 0
      )
        rows.push({
          debt_id: debt.id,
          lender: debt.lender,
          due_date: key,
          amount: Number(debt.monthly_payment),
          kind: "monthly",
        });
    }
    if (
      Number(debt.balloon_amount) > 0 &&
      debt.balloon_date >= dateKey(start) &&
      debt.balloon_date <= dateKey(end) &&
      debt.balloon_date <= debt.end_date
    )
      rows.push({
        debt_id: debt.id,
        lender: debt.lender,
        due_date: debt.balloon_date,
        amount: Number(debt.balloon_amount),
        kind: "balloon",
      });
  }
  return rows.sort((a, b) => a.due_date.localeCompare(b.due_date));
}
export function buildWall(
  transactions,
  debts,
  startingCash,
  today = new Date(),
) {
  const start = parseDate(dateKey(today));
  const historyStart = dateKey(addDays(start, -59));
  // Loan servicing is excluded here because scheduled future payments are deducted below.
  const history = transactions.filter(
    (t) =>
      t.date >= historyStart &&
      t.date <= dateKey(start) &&
      t.category !== "loan_payment",
  );
  const averageDailyNet =
    history.reduce(
      (n, t) => n + (t.type === "income" ? 1 : -1) * Number(t.amount),
      0,
    ) / 60;
  const payments = schedulePayments(debts, start);
  let cash = Number(startingCash),
    firstShortfall = null;
  const weeks = [];
  for (let i = 0; i < 90; i++) {
    const key = dateKey(addDays(start, i));
    cash += averageDailyNet;
    const todays = payments.filter((p) => p.due_date === key);
    for (const p of todays) {
      cash -= p.amount;
      if (cash < 0 && !firstShortfall)
        firstShortfall = { ...p, shortfall: Math.abs(cash) };
    }
    const index = Math.floor(i / 7);
    if (!weeks[index])
      weeks[index] = {
        date: key,
        label: prettyDate(key),
        payments: 0,
        projected_cash: cash,
        min_cash: cash,
        shortfall: false,
      };
    const week = weeks[index];
    week.payments += todays.reduce((n, p) => n + p.amount, 0);
    week.projected_cash = cash;
    week.min_cash = Math.min(week.min_cash, cash);
    week.shortfall = week.min_cash < 0;
  }
  return {
    weeks,
    payments,
    first_shortfall: firstShortfall,
    average_daily_net: averageDailyNet,
    starting_cash: Number(startingCash),
  };
}
export function weeklyTotals(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    const date = parseDate(t.date);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = dateKey(date),
      week = groups.get(key) || { date: key, income: 0, expenses: 0 };
    week[t.type === "income" ? "income" : "expenses"] += Number(t.amount);
    groups.set(key, week);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}
