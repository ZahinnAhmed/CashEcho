import {
  addDays,
  dateKey,
  buildWall,
  validateTransaction,
  validateDebt,
} from "./model.js";
const KEY = "cartwise-demo-v1";
function seed() {
  const today = new Date(),
    transactions = [];
  for (let i = 90; i >= 1; i--) {
    const date = dateKey(addDays(today, -i));
    transactions.push({
      id: `sale-${i}`,
      date,
      type: "income",
      amount: 410 + (i % 7) * 17,
      category: "sales",
      vendor: "Daily cart sales",
      payment_method: "cash",
      note: "Lunch service",
    });
    transactions.push({
      id: `supplies-${i}`,
      date,
      type: "expense",
      amount: 300 + (i % 5) * 13,
      category: "supplies",
      vendor: "Restaurant Depot",
      payment_method: "card",
      note: "Ingredients and packaging",
    });
    if (i % 7 === 0)
      transactions.push({
        id: `payroll-${i}`,
        date,
        type: "expense",
        amount: 480,
        category: "payroll",
        vendor: "Weekly payroll",
        payment_method: "other",
        note: "Cart assistant",
      });
  }
  const debts = [
    {
      id: "sba",
      lender: "SBA business loan",
      kind: "SBA",
      balance: 25000,
      monthly_payment: 520,
      rate_pct: 8,
      payment_day: 5,
      end_date: dateKey(addDays(today, 1000)),
      balloon_amount: 0,
      balloon_date: "",
    },
    {
      id: "equipment",
      lender: "Cart equipment financing",
      kind: "Equipment",
      balance: 6000,
      monthly_payment: 280,
      rate_pct: 10,
      payment_day: 15,
      end_date: dateKey(addDays(today, 44)),
      balloon_amount: 5500,
      balloon_date: dateKey(addDays(today, 35)),
    },
    {
      id: "advance",
      lender: "Merchant cash advance",
      kind: "MCA",
      balance: 8000,
      monthly_payment: 800,
      rate_pct: 0,
      payment_day: 22,
      end_date: dateKey(addDays(today, 300)),
      balloon_amount: 0,
      balloon_date: "",
    },
  ];
  return { transactions, debts, starting_cash: 2400 };
}
let memory;
export function readDemo() {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      memory = JSON.parse(raw);
      return memory;
    }
  } catch {
    /* Private browsing: keep session state. */
  }
  memory = seed();
  return memory;
}
function write(data) {
  memory = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Still works in memory. */
  }
}
export const demo = {
  load: async () => {
    const d = readDemo();
    return { ...d, wall: buildWall(d.transactions, d.debts, d.starting_cash) };
  },
  parse: async (text) => {
    const match = text.replace(/,/g, "").match(/\$?\b(\d+(?:\.\d{1,2})?)\b/);
    if (!match)
      throw new Error(
        "Include an amount, for example “Paid $340 for flour at Restaurant Depot.”",
      );
    const income = /sold|earned|received|sales|made/i.test(text);
    const category = income
      ? "sales"
      : /rent/i.test(text)
        ? "rent"
        : /payroll|wages/i.test(text)
          ? "payroll"
          : /loan payment/i.test(text)
            ? "loan_payment"
            : /equipment|grill/i.test(text)
              ? "equipment"
              : "supplies";
    return {
      type: income ? "income" : "expense",
      amount: Number(match[1]),
      category,
      vendor: text.match(/(?:at|from|to)\s+(.+?)(?:\.|$)/i)?.[1] || "",
      payment_method: /card/i.test(text) ? "card" : "cash",
      date: dateKey(),
      note: text,
      raw_text: text,
    };
  },
  save: async (t) => {
    const item = {
      ...validateTransaction(t),
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    const d = readDemo();
    write({ ...d, transactions: [item, ...d.transactions] });
    return item;
  },
  remove: async (id) => {
    const d = readDemo();
    write({ ...d, transactions: d.transactions.filter((t) => t.id !== id) });
  },
  debt: async (debt) => {
    const item = { ...validateDebt(debt), id: crypto.randomUUID() };
    const d = readDemo();
    write({ ...d, debts: [...d.debts, item] });
    return item;
  },
  cash: async (value) => {
    write({ ...readDemo(), starting_cash: value });
  },
  reset: async () => write(seed()),
};
