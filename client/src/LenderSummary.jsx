import { money, prettyDate } from "./model.js";
import { printPage } from "./lib/print.js";

const monthName = (month) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
const currentMonth = () => new Date().toISOString().slice(0, 7);
const label = (s) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

// Lenders often look for a coverage of 1.25 or higher
function coverageStatus(ratio) {
  if (ratio == null) return { text: "No active loans", tone: "" };
  if (ratio >= 1.25) return { text: "Healthy", tone: "good" };
  if (ratio >= 1) return { text: "Tight", tone: "watch" };
  return { text: "Not covered", tone: "risk" };
}

export default function LenderSummary({ data, onNotice = () => {} }) {
  const coverage = coverageStatus(data.coverage.ratio);
  const shortfall = data.first_shortfall;
  const generated = new Date(data.generated_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="lender-summary">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>{data.business_name}</h2>
            <p className="muted">
              Cash flow and debt summary, prepared {generated} from the
              owner’s own ledger.
            </p>
          </div>
          <button
            type="button"
            className="button outline no-print"
            onClick={() => printPage(onNotice)}
          >
            Print or save as PDF
          </button>
        </div>
        <div className="stats">
          <div className="stat">
            <span>Cash on hand</span>
            <strong>{money(data.cash_on_hand)}</strong>
          </div>
          <div className="stat">
            <span>Monthly operating cash</span>
            <strong>{money(data.coverage.monthly_operating_cash)}</strong>
          </div>
          <div className="stat">
            <span>Monthly loan payments</span>
            <strong>{money(data.coverage.monthly_loan_payments)}</strong>
          </div>
          <div className="stat">
            <span>Debt coverage</span>
            <strong>
              {data.coverage.ratio == null
                ? "n/a"
                : `${data.coverage.ratio.toFixed(2)}x`}{" "}
              <em className={`coverage-tag ${coverage.tone}`}>
                {coverage.text}
              </em>
            </strong>
          </div>
        </div>
        <p className="muted">
          Debt coverage is monthly operating cash, before loan payments, divided
          by monthly loan payments. Lenders often look for 1.25 or higher.
        </p>
      </section>

      <section className="panel">
        <h2>Monthly cash flow</h2>
        {data.monthly.length === 0 ? (
          <p className="muted">No transactions logged yet.</p>
        ) : (
          <table className="summary-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Revenue</th>
                <th>Operating expenses</th>
                <th>Operating cash flow</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.month}>
                  <td>
                    {monthName(m.month)}
                    {m.month === currentMonth() && " (so far)"}
                  </td>
                  <td>{money(m.income)}</td>
                  <td>{money(m.operating_expenses)}</td>
                  <td>{money(m.operating_cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Where the money goes</h2>
        <p className="muted">Operating expenses over the last 90 days.</p>
        {data.expense_categories.length === 0 ? (
          <p className="muted">No expenses logged yet.</p>
        ) : (
          <table className="summary-table">
            <tbody>
              {data.expense_categories.map((c) => (
                <tr key={c.category}>
                  <td>{label(c.category)}</td>
                  <td>{money(c.amount)}</td>
                  <td>{Math.round(c.share * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Loans</h2>
        {data.debts.length === 0 ? (
          <p className="muted">No loans added yet.</p>
        ) : (
          <table className="summary-table">
            <thead>
              <tr>
                <th>Lender</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Payment</th>
                <th>Rate</th>
                <th>Ends</th>
                <th>Balloon</th>
              </tr>
            </thead>
            <tbody>
              {data.debts.map((d) => (
                <tr key={d.lender + d.end_date}>
                  <td>{d.lender}</td>
                  <td>{d.kind || "Loan"}</td>
                  <td>{money(d.balance)}</td>
                  <td>
                    {money(d.monthly_payment)} /{" "}
                    {{ weekly: "week", daily: "business day" }[
                      d.payment_frequency
                    ] || "month"}
                  </td>
                  <td>{d.rate_pct == null ? "n/a" : `${d.rate_pct}%`}</td>
                  <td>{prettyDate(d.end_date)}</td>
                  <td>
                    {d.balloon_amount
                      ? `${money(d.balloon_amount)} on ${prettyDate(d.balloon_date)}`
                      : "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Outlook for the next 90 days</h2>
        {shortfall ? (
          <p>
            A {money(shortfall.amount)} {shortfall.lender} payment is due{" "}
            {prettyDate(shortfall.due_date)}. Cash is projected to be about{" "}
            {money(shortfall.shortfall)} short
            {data.shortfall_probability != null &&
              `, and across ${data.uncertainty.paths.toLocaleString()} simulated outcomes cash drops below zero in ${Math.round(data.shortfall_probability * 100)}% of them`}
            . The owner can use this to talk to the lender before the date.
          </p>
        ) : (
          <p>
            Projected cash covers every scheduled loan payment over the next
            90 days.
          </p>
        )}
        {data.upcoming_payments.length > 0 && (
          <table className="summary-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Lender</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.upcoming_payments.map((p, i) => (
                <tr key={i}>
                  <td>{prettyDate(p.due_date)}</td>
                  <td>{p.lender}</td>
                  <td>
                    {p.kind === "daily"
                      ? `Daily, ${p.count} payments`
                      : label(p.kind || "monthly")}
                  </td>
                  <td>{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="muted summary-note">
        Prepared from the business owner’s own records. Projections come from
        replaying the last 60 days of activity and are estimates, not
        guarantees. This is not financial advice.
      </p>
    </div>
  );
}
