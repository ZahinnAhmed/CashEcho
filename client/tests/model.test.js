import test from "node:test";
import assert from "node:assert/strict";
import {
  schedulePayments,
  buildWall,
  weeklyTotals,
  validateTransaction,
  validateDebt,
} from "../src/model.js";
const debt = {
  id: "1",
  lender: "Equipment",
  balance: 1000,
  monthly_payment: 100,
  rate_pct: 5,
  payment_day: 31,
  end_date: "2027-01-31",
  balloon_amount: 0,
  balloon_date: "",
};
test("payments clamp day 31 to month end, respect maturity and include one balloon", () => {
  const rows = schedulePayments(
    [
      {
        ...debt,
        end_date: "2026-03-15",
        balloon_amount: 500,
        balloon_date: "2026-03-15",
      },
    ],
    new Date("2026-01-01T12:00:00"),
  );
  assert.deepEqual(
    rows.map((r) => [r.due_date, r.amount]),
    [
      ["2026-01-31", 100],
      ["2026-02-28", 100],
      ["2026-03-15", 500],
    ],
  );
});
test("projection excludes historical debt servicing and subtracts upcoming payment once", () => {
  const wall = buildWall(
    [
      { date: "2026-01-31", type: "income", amount: 600, category: "sales" },
      {
        date: "2026-01-31",
        type: "expense",
        amount: 300,
        category: "loan_payment",
      },
    ],
    [{ ...debt, payment_day: 1 }],
    100,
    new Date("2026-02-01T12:00:00"),
  );
  assert.equal(wall.average_daily_net, 10);
  assert.equal(wall.weeks[0].projected_cash, 70);
  assert.equal(wall.weeks[0].payments, 100);
});
test("flags a within-week shortfall even if the week recovers", () => {
  const wall = buildWall(
    [{ date: "2026-01-31", type: "income", amount: 600, category: "sales" }],
    [{ ...debt, monthly_payment: 120, payment_day: 1, end_date: "2026-02-01" }],
    100,
    new Date("2026-02-01T12:00:00"),
  );
  assert.equal(wall.first_shortfall.shortfall, 10);
  assert.equal(wall.weeks[0].shortfall, true);
  assert.equal(wall.weeks[0].projected_cash, 50);
});
test("starting cash, expenses and a balloon change forecast", () => {
  const t = [
    { date: "2026-01-31", type: "income", amount: 600, category: "sales" },
    { date: "2026-01-31", type: "expense", amount: 300, category: "supplies" },
  ];
  const d = {
    ...debt,
    monthly_payment: 0,
    balloon_amount: 200,
    balloon_date: "2026-02-02",
  };
  const low = buildWall(t, [d], 100, new Date("2026-02-01T12:00:00")),
    high = buildWall(t, [d], 1000, new Date("2026-02-01T12:00:00"));
  assert.equal(low.average_daily_net, 5);
  assert.equal(low.first_shortfall.shortfall, 90);
  assert.equal(high.first_shortfall, null);
});
test("weekly totals group Sunday with the preceding Monday", () => {
  assert.deepEqual(
    weeklyTotals([
      { date: "2026-02-01", type: "income", amount: 100 },
      { date: "2026-01-26", type: "expense", amount: 20 },
    ]),
    [{ date: "2026-01-26", income: 100, expenses: 20 }],
  );
});
test("rejects invalid parsed amounts and impossible dates", () => {
  const t = {
    type: "expense",
    amount: 3,
    category: "supplies",
    payment_method: "cash",
    date: "2026-02-30",
  };
  assert.throws(() => validateTransaction(t), /valid date/);
  assert.throws(
    () => validateTransaction({ ...t, date: "2026-02-01", amount: -1 }),
    /greater than zero/,
  );
});
test("rejects balloon after maturity and noninteger payment day", () => {
  assert.throws(
    () =>
      validateDebt({
        ...debt,
        balloon_amount: 100,
        balloon_date: "2027-02-01",
      }),
    /Balloon date/,
  );
  assert.throws(() => validateDebt({ ...debt, payment_day: 1.5 }), /1–31/);
});
