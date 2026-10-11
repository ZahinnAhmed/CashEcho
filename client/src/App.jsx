import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Check,
  X,
  Volume2,
  Wallet,
  BookOpen,
  ChartNoAxesCombined,
  ArrowRight,
  RefreshCw,
  Download,
  Undo2,
  TriangleAlert,
  LogOut,
  FileText,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { api, DEMO, hasSession, getUser } from "./api.js";
import GoogleSignIn from "./GoogleSignIn.jsx";
import LenderSummary from "./LenderSummary.jsx";
import ImportPanel from "./ImportPanel.jsx";
import FixPanel from "./FixPanel.jsx";
import AnswerCard from "./AnswerCard.jsx";
import {
  categories,
  dateKey,
  addDays,
  money,
  wholeMoney,
  prettyDate,
  weeklyTotals,
  validateTransaction,
  validateDebt,
} from "./model.js";
import { useRecorder } from "./useRecorder.js";
import VoiceSettings from "./components/VoiceSettings.jsx";
import {
  confirmationLine,
  playSound,
  speak,
  stopAudio,
  unlockAudio,
} from "./lib/voiceClient.js";

const tabs = [
  { id: "log", label: "Log money", icon: Mic },
  { id: "ledger", label: "Ledger", icon: BookOpen },
  { id: "wall", label: "Debt Wall", icon: ChartNoAxesCombined },
  { id: "summary", label: "Lender summary", icon: FileText, realOnly: true },
];
const blankTransaction = () => ({
  type: "expense",
  amount: "",
  category: "supplies",
  vendor: "",
  payment_method: "cash",
  date: dateKey(),
  note: "",
});
const blankDebt = () => ({
  lender: "",
  kind: "Equipment",
  balance: "",
  monthly_payment: "",
  rate_pct: 0,
  payment_day: 15,
  payment_frequency: "monthly",
  payment_weekday: 5,
  end_date: dateKey(addDays(new Date(), 365)),
  balloon_amount: 0,
  balloon_date: "",
});
// "15" -> "15th", for "Due on the 15th"
const ordinal = (n) => {
  const v = n % 100;
  return `${n}${["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"}`;
};
// Debt coverage in everyday words: how many times the month's earnings cover the loan payments
function coverageText({ monthly_operating_cash: earn, monthly_loan_payments: pay, ratio }) {
  const base = `In a typical month you bring in about ${money(earn)} after costs, and your loan payments add up to about ${money(pay)}.`;
  if (ratio >= 1.25)
    return `${base} That covers them ${ratio >= 10 ? "many" : ratio.toFixed(1)} times over, which is a healthy cushion.`;
  if (ratio >= 1)
    return `${base} That just covers them, with little room to spare.`;
  if (ratio > 0)
    return `${base} That only covers about ${Math.round(ratio * 100)}% of them, so you’d need other money to make up the rest.`;
  return `${base} Right now your costs are higher than what you bring in, so the payments would have to come from savings.`;
}
const title = (s) =>
  s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

function BrandFrog({ size = 24, className = "" }) {
  return (
    <svg
      className={`brand-frog ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <g>
        <ellipse cx="12" cy="14" rx="8.6" ry="6.8" fill="#59b65e" />
        <ellipse cx="12" cy="15.1" rx="6.5" ry="4.9" fill="#7cd57a" opacity="0.8" />
        <circle cx="8.5" cy="8.5" r="1.25" fill="#ffffff" />
        <circle cx="15.5" cy="8.5" r="1.25" fill="#ffffff" />
        <circle cx="8.5" cy="9.2" r="0.55" fill="#1d3d2f" />
        <circle cx="15.5" cy="9.2" r="0.55" fill="#1d3d2f" />
        <path
          d="M 9 11.2 Q 12 8.6 15 11.2"
          fill="none"
          stroke="#1d3d2f"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <path
          d="M 7 16.5 Q 12 18.5 17 16.5"
          fill="none"
          stroke="#1d3d2f"
          strokeWidth="1.55"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function TransactionFields({ value, setValue }) {
  const update = (key) => (event) =>
    setValue({ ...value, [key]: event.target.value });
  return (
    <div className="form-grid">
      <Field label="Type">
        <select value={value.type} onChange={update("type")}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </Field>
      <Field label="Amount ($)">
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          value={value.amount}
          onChange={update("amount")}
        />
      </Field>
      <Field label="Category">
        <select value={value.category} onChange={update("category")}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {title(c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Payment method">
        <select
          value={value.payment_method}
          onChange={update("payment_method")}
        >
          {["cash", "card", "other"].map((c) => (
            <option key={c} value={c}>
              {title(c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vendor / customer">
        <input
          value={value.vendor || ""}
          onChange={update("vendor")}
          placeholder="Restaurant Depot"
        />
      </Field>
      <Field label="Date">
        <input
          required
          type="date"
          value={value.date}
          onChange={update("date")}
        />
      </Field>
      <Field label="Note">
        <input
          value={value.note || ""}
          onChange={update("note")}
          placeholder="Ingredients for tomorrow"
        />
      </Field>
    </div>
  );
}
function Entries({ items, onDelete, busy }) {
  if (!items.length)
    return (
      <div className="empty">
        No transactions here yet. Log your first sale or expense.
      </div>
    );
  return (
    <div className="entries">
      {items.map((t) => (
        <div className="entry" key={t.id}>
          <div className={`entry-icon ${t.type}`}>
            {t.type === "income" ? (
              <ArrowDownLeft size={18} />
            ) : (
              <ArrowUpRight size={18} />
            )}
          </div>
          <div className="entry-copy">
            <strong>{t.vendor || title(t.category)}</strong>
            <span>
              {title(t.category)} · {prettyDate(t.date)}
            </span>
          </div>
          <strong className={t.type === "income" ? "positive" : ""}>
            {t.type === "income" ? "+" : "−"}
            {money(t.amount)}
          </strong>
          <button
            className="icon-button"
            disabled={busy}
            aria-label={`Delete ${t.vendor || t.category} transaction`}
            onClick={() => onDelete(t)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>Week of {row.label}</strong>
      <p>Loan payments: {money(row.payments)}</p>
      <p>Cash at the end of the week: {money(row.projected_cash)}</p>
      <p>Lowest point that week: {money(row.min_cash ?? row.projected_cash)}</p>
      {row.band && (
        <p>
          Most likely between {wholeMoney(row.band[0])} and {wholeMoney(row.band[1])}
        </p>
      )}
      {row.shortfall_prob != null && (
        <p>
          Chance of running short by then: {Math.round(row.shortfall_prob * 100)}%
        </p>
      )}
      {row.shortfall && <b className="danger-text">You could run short this week</b>}
    </div>
  );
}
// Gentle checks for numbers that are probably typed in the wrong box. They warn but don't block.
function loanWarnings(value, averageDailyIncome) {
  const payment = Number(value.monthly_payment),
    balance = Number(value.balance),
    warnings = [];
  if (payment > 0 && balance > 0 && payment > balance)
    warnings.push(
      "Each payment is bigger than what you still owe. Did you mean to put this amount in “How much do you still owe?”",
    );
  if (payment > 0 && averageDailyIncome > 0) {
    const days = payment / averageDailyIncome;
    if (days > 50)
      warnings.push(
        `This one payment is about ${Math.round(days).toLocaleString()} days of your usual earnings. Double-check the amount.`,
      );
  }
  return warnings;
}
function DebtForm({ initial, onSave, onCancel, busy, averageDailyIncome }) {
  const editing = Boolean(initial);
  const [value, setValue] = useState(() =>
      initial
        ? {
            ...blankDebt(),
            ...initial,
            kind: initial.kind || "Other",
            rate_pct: initial.rate_pct ?? 0,
            payment_day: initial.payment_day ?? 15,
            payment_weekday: initial.payment_weekday ?? 5,
            balloon_amount: initial.balloon_amount ?? 0,
            balloon_date: initial.balloon_date ?? "",
          }
        : blankDebt(),
    ),
    [error, setError] = useState("");
  const update = (k) => (e) => setValue({ ...value, [k]: e.target.value });
  const warnings = loanWarnings(value, averageDailyIncome);
  // The form sits above the loan cards, so bring it into view when it opens
  const formRef = useRef(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const every =
    { weekly: "week", daily: "business day" }[value.payment_frequency] ||
    "month";
  async function submit(e) {
    e.preventDefault();
    try {
      setError("");
      await onSave(validateDebt(value));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <form ref={formRef} onSubmit={submit} className="panel debt-form">
      <div className="section-head">
        <h2>{editing ? `Edit ${initial.lender}` : "Add a loan"}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          aria-label="Close loan form"
        >
          <X />
        </button>
      </div>
      <div className="form-grid">
        <Field label="Who is the loan from?">
          <input
            required
            value={value.lender}
            onChange={update("lender")}
            placeholder="For example, SBA or Kabbage"
          />
        </Field>
        <Field label="What kind of loan?">
          <select value={value.kind} onChange={update("kind")}>
            {[
              ["SBA", "Government (SBA) loan"],
              ["Equipment", "Equipment loan"],
              ["MCA", "Cash advance"],
              ["Other", "Something else"],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How much do you still owe? ($)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.balance}
            onChange={update("balance")}
            placeholder="The total left to pay"
          />
        </Field>
        {!DEMO && (
          <Field label="How often do you pay?">
            <select
              value={value.payment_frequency}
              onChange={update("payment_frequency")}
            >
              <option value="monthly">Once a month</option>
              <option value="weekly">Once a week</option>
              <option value="daily">Every weekday (Mon to Fri)</option>
            </select>
          </Field>
        )}
        <Field label={`How much do you pay each ${every}? ($)`}>
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.monthly_payment}
            onChange={update("monthly_payment")}
            placeholder="One payment, not the total"
          />
        </Field>
        <Field label="Interest rate per year (%)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.rate_pct}
            onChange={update("rate_pct")}
          />
        </Field>
        {value.payment_frequency === "monthly" && (
          <Field label="Which day of the month is it due?">
            <input
              required
              type="number"
              min="1"
              max="31"
              step="1"
              value={value.payment_day}
              onChange={update("payment_day")}
            />
          </Field>
        )}
        {value.payment_frequency === "weekly" && (
          <Field label="Which day of the week?">
            <select
              value={value.payment_weekday}
              onChange={update("payment_weekday")}
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="When does the loan end?">
          <input
            required
            type="date"
            min={dateKey()}
            value={value.end_date}
            onChange={update("end_date")}
          />
        </Field>
        <Field label="Big final payment, if any ($)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.balloon_amount}
            onChange={update("balloon_amount")}
          />
        </Field>
        {Number(value.balloon_amount) > 0 && (
          <Field label="When is the final payment due?">
            <input
              required
              type="date"
              min={dateKey()}
              max={value.end_date}
              value={value.balloon_date}
              onChange={update("balloon_date")}
            />
          </Field>
        )}
      </div>
      {warnings.map((w) => (
        <p key={w} className="loan-warning" role="status">
          <TriangleAlert size={16} />
          {w}
        </p>
      ))}
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : editing ? "Save changes" : "Save loan"}
        <Check size={17} />
      </button>
    </form>
  );
}
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!DEMO && hasSession());
  const [user, setUser] = useState(!DEMO ? getUser() : null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ name: "", email: "", password: "" });
  const [authMode, setAuthMode] = useState("login");
  const [summary, setSummary] = useState(null);
  const [language, setLanguage] = useState({ language: "en", languages: [] });
  const [authBusy, setAuthBusy] = useState(false);
  const [tab, setTab] = useState("log"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [text, setText] = useState(""),
    [draft, setDraft] = useState(null),
    [manual, setManual] = useState(false),
    [loanForm, setLoanForm] = useState(false),
    [lastSaved, setLastSaved] = useState(null),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [playing, setPlaying] = useState(false),
    [cashInput, setCashInput] = useState("");
  const toastTimer = useRef(null);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api.load();
      if (
        !Array.isArray(result.transactions) ||
        !Array.isArray(result.debts) ||
        !Array.isArray(result.wall?.weeks)
      )
        throw new Error(
          "Unexpected API response. Check the response shapes in README.md.",
        );
      setData(result);
      setCashInput(
        String(Math.round((Number(result.starting_cash) || 0) * 100) / 100),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Signed in earlier but the name was never saved in this browser: ask the server
    if (isLoggedIn && !DEMO && !user) api.me().then(setUser).catch(() => {});
  }, [isLoggedIn]);
  // When the page changes, move focus to its heading so a screen reader starts reading the new page
  const headingRef = useRef(null);
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [tab]);
  // The owner's voice language (what they speak, and what the app speaks back)
  useEffect(() => {
    if (isLoggedIn && !DEMO) api.getLanguage().then(setLanguage).catch(() => {});
  }, [isLoggedIn]);
  async function changeLanguage(code) {
    const previous = language;
    setLanguage({ ...language, language: code });
    try {
      await api.setLanguage(code, language.languages);
    } catch (e) {
      setLanguage(previous);
      setError(e.message);
    }
  }
  // The lender summary is loaded whenever its tab is opened, so the numbers are current
  useEffect(() => {
    if (tab !== "summary" || !isLoggedIn || DEMO) return;
    setSummary(null);
    api.summary().then(setSummary).catch((e) => setError(e.message));
  }, [tab, isLoggedIn]);
  useEffect(() => {
    if (isLoggedIn) void load();
    return () => {
      stopAudio();
      clearTimeout(toastTimer.current);
    };
  }, [isLoggedIn]);
  function notify(message) {
    setNotice(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(""), 6000);
  }
  function handleSignOut() {
    api.logout(); // forget the session token
    window.google?.accounts?.id?.disableAutoSelect?.();
    setData(null);
    setUser(null);
    setError("");
    setTab("log");
    setIsLoggedIn(false);
  }
  // Signs in or signs up. In demo mode there is no server, so it just lets you in.
  async function authenticate(call, fallbackName) {
    setError("");
    if (DEMO) {
      setUser(fallbackName ? { name: fallbackName } : null);
      setIsLoggedIn(true);
      return;
    }
    setAuthBusy(true);
    try {
      setUser(await call());
      setIsLoggedIn(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthBusy(false);
    }
  }
  function handleLoginSubmit(event) {
    event.preventDefault();
    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      setError("Please enter both your email and password.");
      return;
    }
    void authenticate(() => api.login(loginForm));
  }
  function handleSignupSubmit(event) {
    event.preventDefault();
    if (
      !signupForm.name.trim() ||
      !signupForm.email.trim() ||
      !signupForm.password.trim()
    ) {
      setError("Please fill in your name, email, and password.");
      return;
    }
    if (signupForm.password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    void authenticate(() => api.signup(signupForm), signupForm.name.trim());
  }
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  // What the assistant last said back (an answer or a question), and what it is waiting to hear
  const [reply, setReply] = useState(null);
  const [waitingFor, setWaitingFor] = useState(null);
  const [incoming, setIncoming] = useState(null); // entries from a spoken catch-up, waiting for review
  // Everything the owner says or types comes through here. A sale or expense goes on to the
  // confirm card; a question is answered out loud from their own numbers.
  async function parse(textValue) {
    if (!DEMO) {
      // The assistant only waits for its answer for one turn; after that it is a fresh request
      const pending = waitingFor;
      setWaitingFor(null);
      const result = await api.ask(textValue, pending);
      if (result.type === "catchup") {
        // A whole stretch said in one go ("this week we sold 3200 and spent 1900"): show the
        // entries for a quick check before saving
        const summary = await api.catchup(textValue);
        setIncoming(summary.transactions);
        setReply(null);
        setWaitingFor(null);
        setText("");
        say("Here is what I heard. Please check it, then add it.").catch(() => {});
        return;
      }
      if (result.type !== "log") {
        setWaitingFor(result.pending || null);
        setReply({ question: textValue, text: result.text, asking: result.type === "ask" });
        setText("");
        if (result.type === "ask") {
          // Ask, then listen: no need to find the mic button
          setPlaying(true);
          speak(result.text, () => {
            setPlaying(false);
            void recorderRef.current.start();
          }).catch(() => {});
        } else say(result.text).catch(() => {});
        return;
      }
      setWaitingFor(null);
      setReply(null);
    }
    setText(textValue); // keeps a spoken transcript editable if parsing fails
    const value = await api.parse(textValue);
    setDraft(validateTransaction(value));
    setManual(false);
  }
  const recorder = useRecorder(parse, setError);
  // The latest recorder, for the callback that opens the mic after a spoken follow-up question
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  // Playback goes through lib/voiceClient.js so iPhone Safari allows it after a tap.
  function playAudio(source) {
    setPlaying(true);
    return playSound(source, () => setPlaying(false));
  }
  function say(textValue) {
    setPlaying(true);
    return speak(textValue, () => setPlaying(false));
  }
  async function afterImport(count) {
    unlockAudio();
    await load();
    notify(`Added ${count} ${count === 1 ? "entry" : "entries"} from your records.`);
    say(`Added ${count} ${count === 1 ? "entry" : "entries"} to your ledger.`).catch(() => {});
  }
  async function save(e) {
    e.preventDefault();
    unlockAudio();
    await run(async () => {
      const saved = await api.save(validateTransaction(draft));
      setLastSaved(saved);
      setDraft(null);
      setText("");
      setManual(false);
      notify(`Logged ${money(saved.amount)} ${saved.type}.`);
      say(confirmationLine(saved)).catch(() =>
        notify("Transaction saved. Voice playback is unavailable."),
      );
      await load();
    });
  }
  async function remove(t) {
    await run(async () => {
      await api.remove(t.id);
      if (lastSaved?.id === t.id) setLastSaved(null);
      await load();
      notify("Transaction removed.");
    });
  }
  const transactions = [...(data?.transactions || [])].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
  // In API mode the weekly totals come from the server (Tiger Data time_bucket)
  const weeks = data?.weekly ?? weeklyTotals(transactions),
    currentWeek = weeks.find((w) => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return w.date === dateKey(d);
    }) || { income: 0, expenses: 0 };
  const wall = data?.wall,
    shortfall = wall?.first_shortfall;
  const alertText = shortfall
    ? `Your ${shortfall.lender} payment of ${money(shortfall.amount)} is due ${prettyDate(shortfall.due_date)}. At your current pace, you’ll have about ${money(Math.round(shortfall.shortfall))} less than you need. There’s still time to plan: bring in a little extra, set some cash aside, or talk to your lender early.`
    : "Good news: at your current pace, you’ll have enough for every loan payment in the next 90 days. Keep logging your sales and costs so this stays accurate.";
  // Get the spoken alert ready as soon as the Debt Wall opens (or the language changes), so
  // tapping "Hear alert" does not wait for the translation and the voice
  const alertPrefetch = useRef(null);
  useEffect(() => {
    if (tab !== "wall" || !isLoggedIn || DEMO || !data) return;
    alertPrefetch.current = api.alert().catch(() => null);
  }, [
    tab,
    isLoggedIn,
    language.language,
    data?.wall?.first_shortfall?.due_date,
    data?.wall?.starting_cash,
  ]);
  async function playAlert() {
    unlockAudio();
    await run(async () => {
      if (playing) {
        stopAudio();
        return;
      }
      if (DEMO) await say(alertText);
      else {
        // If /api/alert is down, play the alert pre-rendered for the demo.
        const result =
          (await alertPrefetch.current) ??
          (await api.alert().catch(() => ({ audio_url: "/demo/alert.mp3" })));
        const url = result.audio_url || result.audioUrl;
        const spoken = result.text || result.alert_text || alertText;
        if (url) await playAudio(url).catch(() => say(spoken));
        else await say(spoken);
      }
    });
  }
  if (!isLoggedIn) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">
            <span className="brand-symbol login-icon">
              <BrandFrog size={50} />
            </span>
            <span>Cashecho</span>
          </div>
          <p className="login-subtitle">
            {authMode === "login"
              ? "Sign in to manage cash flow, debt planning, and daily spending."
              : "Create an account to save your business cash plan and sign back in later."}
          </p>
          <div
            className="auth-mode-switch"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              className={`auth-mode ${authMode === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("login");
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-mode ${authMode === "signup" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("signup");
                setError("");
              }}
            >
              Sign up
            </button>
          </div>
          {authMode === "login" ? (
            <form className="login-form" onSubmit={handleLoginSubmit}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm({ ...loginForm, email: event.target.value })
                  }
                  placeholder="you@example.com"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm({ ...loginForm, password: event.target.value })
                  }
                  placeholder="Enter your password"
                />
              </label>
              {error && <p className="login-error">{error}</p>}
              <button
                type="submit"
                className="button primary login-button"
                disabled={authBusy}
              >
                {authBusy ? "Signing in…" : "Log in"}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleSignupSubmit}>
              <label>
                <span>Full name</span>
                <input
                  type="text"
                  value={signupForm.name}
                  onChange={(event) =>
                    setSignupForm({ ...signupForm, name: event.target.value })
                  }
                  placeholder="Your name"
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={signupForm.email}
                  onChange={(event) =>
                    setSignupForm({ ...signupForm, email: event.target.value })
                  }
                  placeholder="you@example.com"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={signupForm.password}
                  onChange={(event) =>
                    setSignupForm({
                      ...signupForm,
                      password: event.target.value,
                    })
                  }
                  placeholder="At least 8 characters"
                />
              </label>
              {error && <p className="login-error">{error}</p>}
              <button
                type="submit"
                className="button primary login-button"
                disabled={authBusy}
              >
                {authBusy ? "Creating account…" : "Create account"}
              </button>
            </form>
          )}
          {!DEMO && (
            <>
              <div className="login-divider">
                <span>or</span>
              </div>
              <GoogleSignIn
                onSignedIn={(signedInUser) => {
                  setUser(signedInUser);
                  setIsLoggedIn(true);
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          onClick={() => setTab("log")}
        >
          <span className="brand-symbol">
            <BrandFrog size={46} />
          </span>
          Cashecho<span className="brand-dot">.</span>
        </button>
        <p className="sidebar-label">YOUR BUSINESS, IN VIEW</p>
        <nav aria-label="Main navigation">
          {tabs.filter((t) => !(DEMO && t.realOnly)).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              {label}
              {tab === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-leaf">
            <BrandFrog size={18} />
          </span>
          <h3>Small cart. Big picture.</h3>
          <p>A little clarity for the business you’re building.</p>
        </div>
        <div className="business">
          {user?.picture ? (
            <img
              className="avatar"
              src={user.picture}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="avatar">
              {user
                ? user.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                : "QC"}
            </span>
          )}
          <div>
            <strong>{user ? user.name : "Cashecho"}</strong>
            {!user && (
              <span>{DEMO ? "Demo business" : "Business workspace"}</span>
            )}
          </div>
          <button
            type="button"
            className="icon-button signout"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main id="main">
        <header className="topbar">
          <span>
            {DEMO && (
              <>
                <span className="status-dot" />
                Interactive demo
              </>
            )}
          </span>
          <div className="top-actions">
            {!DEMO && language.languages.length > 0 && (
              <label className="language-picker">
                <span>Voice language</span>
                <select
                  value={language.language}
                  onChange={(e) => void changeLanguage(e.target.value)}
                  aria-label="Voice language"
                >
                  {language.languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {DEMO && (
              <button
                className="text-button"
                disabled={busy || recorder.status !== "idle"}
                onClick={() =>
                  run(async () => {
                    await api.reset();
                    setDraft(null);
                    setLastSaved(null);
                    await load();
                    notify("Demo restored.");
                  })
                }
              >
                <RefreshCw size={14} />
                Reset demo
              </button>
            )}
            <span className="date-label">
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {user && (
              <button
                type="button"
                className="text-button topbar-signout"
                onClick={handleSignOut}
              >
                <LogOut size={14} />
                Sign out
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "log"
                  ? "LESS PAPERWORK. MORE POSSIBILITY."
                  : tab === "ledger"
                    ? "EVERY DOLLAR, ACCOUNTED FOR."
                    : tab === "summary"
                      ? "READY FOR YOUR LENDER."
                      : "LOOK AHEAD WITH CONFIDENCE."}
              </p>
              <h1 ref={headingRef} tabIndex={-1}>
                {tab === "log"
                  ? "Your money. In your words."
                  : tab === "ledger"
                    ? "The story behind your numbers."
                    : tab === "summary"
                      ? "Your business, on one page."
                      : "See the squeeze before it hits."}
              </h1>
              <p>
                {tab === "log"
                  ? "Say a sale or an expense. We’ll take care of the entry."
                  : tab === "ledger"
                    ? "A clear record of what comes in and what goes out."
                    : tab === "summary"
                      ? "Revenue, cash flow and your debt schedule, ready to print."
                      : "Your next 90 days of cash and loan payments, together."}
              </p>
            </div>
            {(tab === "wall" || tab === "ledger") && (
              <button
                className="button outline"
                disabled={!data}
                onClick={() => window.print()}
              >
                <Download size={17} />
                Print summary
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <TriangleAlert size={20} />
              <span>{error}</span>
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="loading" role="status">
              <RefreshCw className="spin" />
              Loading your business…
            </div>
          ) : !data ? (
            <div className="empty">
              <p>We couldn’t load your business.</p>
              <button className="button primary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="stats">
                <div className="stat">
                  <span>
                    This week’s income
                    <ArrowDownLeft size={16} />
                  </span>
                  <strong>{money(currentWeek.income)}</strong>
                  <small>Sales and money received</small>
                </div>
                <div className="stat">
                  <span>
                    This week’s expenses
                    <ArrowUpRight size={16} />
                  </span>
                  <strong>{money(currentWeek.expenses)}</strong>
                  <small>All logged expenses</small>
                </div>
                <div className="stat emphasized">
                  <span>
                    {tab === "wall" ? "Cash you have now" : "This week’s net cash"}
                    <Wallet size={16} />
                  </span>
                  <strong>
                    {money(
                      tab === "wall"
                        ? data.starting_cash
                        : currentWeek.income - currentWeek.expenses,
                    )}
                  </strong>
                  <small>
                    {tab === "wall"
                      ? "What the forecast starts from"
                      : "Income minus expenses"}
                  </small>
                </div>
              </div>
              {tab === "log" && (
                <div className="log-layout">
                  <section className="panel voice-panel">
                    <div className="section-head">
                      <h2>Let’s log it.</h2>
                      <span className="pill">
                        {DEMO ? "Demo voice" : "Voice ledger"}
                      </span>
                    </div>
                    <p className="muted">Tap, speak, and check the details.</p>
                    <div className="mic-area">
                      <button
                        className={`mic-button ${recorder.status === "recording" ? "recording" : ""}`}
                        disabled={
                          busy ||
                          !!draft ||
                          ["starting", "sending"].includes(recorder.status)
                        }
                        onClick={() => {
                          setError("");
                          unlockAudio();
                          recorder.status === "recording"
                            ? recorder.stop()
                            : void recorder.start();
                        }}
                        aria-label={
                          recorder.status === "recording"
                            ? "Stop recording"
                            : "Start recording"
                        }
                      >
                        {recorder.status === "recording" ? (
                          <Square fill="currentColor" size={28} />
                        ) : ["starting", "sending"].includes(
                            recorder.status,
                          ) ? (
                          <RefreshCw className="spin" size={30} />
                        ) : (
                          <Mic size={34} />
                        )}
                      </button>
                      <strong>
                        {recorder.status === "recording"
                          ? `Listening… ${recorder.seconds}s`
                          : recorder.status === "sending"
                            ? "Turning words into numbers…"
                            : recorder.status === "starting"
                              ? "Opening your microphone…"
                              : "Tap to start talking"}
                      </strong>
                      <span>
                        {recorder.status === "recording"
                          ? "It stops by itself when you pause, or tap to stop."
                          : DEMO
                            ? "“Paid $340 for flour at Restaurant Depot.”"
                            : "Say a sale or expense, or ask “How much did we spend last week?”"}
                      </span>
                    </div>
                    <p className="sr-only" role="status" aria-live="assertive">
                      {{
                        recording: "Listening. Speak now. It stops by itself when you pause.",
                        starting: "Opening the microphone.",
                        sending: "Working on what you said.",
                      }[recorder.status] || ""}
                    </p>
                    <VoiceSettings
                      recorder={recorder}
                      disabled={busy || !!draft}
                      onError={setError}
                    />
                    {DEMO && (
                      <p className="micro-copy">
                        Demo uses a simple text parser and browser voice. Review
                        the amount before saving. ElevenLabs requires the
                        backend.
                      </p>
                    )}
                    <div className="divider">
                      <span>or type it</span>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(() => parse(text));
                      }}
                    >
                      <label className="sr-only" htmlFor="spoken-text">
                        Transaction description
                      </label>
                      <textarea
                        id="spoken-text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={DEMO ? "Received $650 in sales today" : "Received $650 in sales today, or: how much did we spend last week?"}
                        rows={2}
                        disabled={busy || recorder.status !== "idle"}
                      />
                      <div className="row-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy || recorder.status !== "idle"}
                          onClick={() => {
                            setDraft(blankTransaction());
                            setManual(true);
                          }}
                        >
                          Enter manually
                        </button>
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            !text.trim() ||
                            !!draft ||
                            recorder.status !== "idle"
                          }
                        >
                          {busy ? "Working…" : "Review entry"}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </form>
                  </section>
                  <div className="log-right">
                    {reply && (
                      <AnswerCard
                        reply={reply}
                        onReplay={() => say(reply.text).catch(() => {})}
                        onClose={() => {
                          setReply(null);
                          setWaitingFor(null);
                        }}
                      />
                    )}
                    {!DEMO && !draft && (
                      <ImportPanel
                        onImported={afterImport}
                        onError={setError}
                        incoming={incoming}
                        onIncomingHandled={() => setIncoming(null)}
                      />
                    )}
                    {draft ? (
                      <form className="panel confirmation" onSubmit={save}>
                        <div className="section-head">
                          <h2>
                            {manual ? "New entry" : "Did we get it right?"}
                          </h2>
                          <Check size={20} />
                        </div>
                        <p className="muted">
                          Check or edit the details before saving.
                        </p>
                        <TransactionFields value={draft} setValue={setDraft} />
                        <div className="row-actions">
                          <button
                            className="button outline"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDraft(null);
                              setManual(false);
                            }}
                          >
                            Discard
                          </button>
                          <button className="button primary" disabled={busy}>
                            {busy ? "Saving…" : "Confirm & save"}
                            <Check size={16} />
                          </button>
                        </div>
                      </form>
                    ) : (
                      <section className="panel recent-panel">
                        <div className="section-head">
                          <h2>Recent activity</h2>
                          <button
                            className="text-button"
                            onClick={() => setTab("ledger")}
                          >
                            View all
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        <Entries
                          items={transactions.slice(0, 5)}
                          onDelete={remove}
                          busy={busy}
                        />
                      </section>
                    )}
                    <section
                      className={`forecast-card ${shortfall ? "at-risk" : ""}`}
                    >
                      <div className="forecast-icon">
                        <ChartNoAxesCombined size={23} />
                      </div>
                      <p className="eyebrow">A HEADS-UP FOR YOUR BUSINESS</p>
                      <h2>
                        {shortfall
                          ? "A payment needs your attention."
                          : "A little breathing room."}
                      </h2>
                      <p>
                        {shortfall
                          ? `Your cash may fall short around ${prettyDate(shortfall.due_date)}. Take a look while there’s time to plan.`
                          : "Your projected cash covers the next 90 days of scheduled payments."}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setTab("wall")}
                      >
                        See your Debt Wall
                        <ArrowRight size={17} />
                      </button>
                    </section>
                  </div>
                </div>
              )}
              {tab === "ledger" && (
                <>
                  <section className="panel">
                    <div className="section-head">
                      <h2>
                        Transactions{" "}
                        <span className="count">{transactions.length}</span>
                      </h2>
                      <button
                        className="button primary"
                        onClick={() => {
                          setDraft(blankTransaction());
                          setManual(true);
                          setTab("log");
                        }}
                      >
                        <Plus size={16} />
                        Add entry
                      </button>
                    </div>
                    <div className="filters">
                      <label className="sr-only" htmlFor="search">
                        Search transactions
                      </label>
                      <input
                        id="search"
                        placeholder="Search vendor or note…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <label className="sr-only" htmlFor="filter">
                        Filter type
                      </label>
                      <select
                        id="filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All transactions</option>
                        <option value="income">Income only</option>
                        <option value="expense">Expenses only</option>
                      </select>
                    </div>
                    <Entries
                      items={transactions.filter(
                        (t) =>
                          (filter === "all" || t.type === filter) &&
                          `${t.vendor} ${t.note} ${t.category}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )}
                      onDelete={remove}
                      busy={busy}
                    />
                  </section>
                  <section className="panel weekly">
                    <h2>Weekly totals</h2>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Week of</th>
                            <th>Income</th>
                            <th>Expenses</th>
                            <th>Net cash</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weeks.map((w) => (
                            <tr key={w.date}>
                              <td>{prettyDate(w.date)}</td>
                              <td className="positive">{money(w.income)}</td>
                              <td>{money(w.expenses)}</td>
                              <td>{money(w.income - w.expenses)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {tab === "summary" && !DEMO && (
                summary ? <LenderSummary data={summary} /> : <p className="muted">Loading your summary…</p>
              )}
              {tab === "wall" && (
                <>
                  <section
                    className={`alert-banner ${shortfall ? "risk" : "safe"}`}
                  >
                    <TriangleAlert size={25} />
                    <div>
                      <h2>
                        {shortfall
                          ? `You may be ${money(Math.round(shortfall.shortfall))} short on ${prettyDate(shortfall.due_date)}`
                          : "You’re on track for your loan payments"}
                      </h2>
                      <p>{alertText}</p>
                      {wall.coverage?.ratio != null && (
                        <p className="micro-copy">
                          {coverageText(wall.coverage)}
                        </p>
                      )}
                      {wall.early_days && (
                        <p className="micro-copy">
                          You’ve logged {wall.early_days}{" "}
                          {wall.early_days === 1 ? "day" : "days"} so far, so
                          this is a rough guide. Enter your cash on hand below
                          the chart and keep logging, and it will get sharper
                          each day.
                        </p>
                      )}
                      {wall.history_needed && wall.payments.length > 0 && (
                        <p className="micro-copy">
                          Once you’ve logged about two weeks, we’ll also show
                          how likely you are to run short. You have{" "}
                          {wall.history_needed.days_logged}{" "}
                          {wall.history_needed.days_logged === 1 ? "day" : "days"}{" "}
                          so far.
                        </p>
                      )}
                      {wall.days_since_last_entry >= 7 && (
                        <p className="micro-copy">
                          You haven’t logged anything in{" "}
                          {wall.days_since_last_entry} days, so this may be out
                          of date. You can catch up in one go, for example:
                          “this week we sold 3,200 and spent 1,900 on
                          supplies.”
                        </p>
                      )}
                      {wall.uncertainty && (
                        <p className="micro-copy">
                          {wall.uncertainty.mode === "weekly"
                            ? `We played out ${wall.uncertainty.paths.toLocaleString()} possible futures using the weeks you’ve logged.`
                            : `We played out ${wall.uncertainty.paths.toLocaleString()} possible futures using your last ${wall.uncertainty.history_days} days.`}{" "}
                          {shortfall?.probability != null
                            ? `You ran short by ${prettyDate(shortfall.due_date)} in about ${Math.round(shortfall.probability * 100)} out of 100 of them.`
                            : `You ran short at some point in about ${Math.round(wall.shortfall_probability * 100)} out of 100 of them.`}
                        </p>
                      )}
                    </div>
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() => void playAlert()}
                    >
                      <Volume2 size={18} />
                      {playing ? "Stop audio" : "Hear alert"}
                    </button>
                  </section>
                  {!DEMO && (
                    <FixPanel
                      refreshKey={`${wall.shortfall_probability}|${wall.payments.length}|${wall.starting_cash}`}
                    />
                  )}
                  <section className="panel wall-panel">
                    <div className="section-head">
                      <div>
                        <h2>Your next 90 days</h2>
                        <p className="muted">
                          How much cash you’re likely to have after each loan
                          payment. Red weeks are when you could run out.
                        </p>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-line" />
                          Cash available
                        </span>
                        <span>
                          <i className="legend-bar" />
                          Payments due
                        </span>
                        {wall.uncertainty && (
                          <span>
                            <i className="legend-band" />
                            Likely range
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className="chart-container"
                      role="img"
                      aria-label={
                        shortfall
                          ? `90-day cash forecast. Cash is projected to go below zero around ${prettyDate(shortfall.due_date)}, when a ${money(shortfall.amount)} payment to ${shortfall.lender} is due, about ${money(Math.round(shortfall.shortfall))} short.${shortfall.probability != null ? ` The chance of that is about ${Math.round(shortfall.probability * 100)} percent.` : ""} The full numbers are in the table below the chart.`
                          : "90-day cash forecast. Cash stays above zero for every scheduled payment. The full numbers are in the table below the chart."
                      }
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={wall.weeks}
                          margin={{ top: 20, right: 15, bottom: 8, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 5"
                            vertical={false}
                            stroke="#e8ece7"
                          />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "#727e75", fontSize: 11 }}
                            minTickGap={26}
                          />
                          <YAxis
                            tickFormatter={(n) => {
                              const sign = n < 0 ? "-" : "";
                              const abs = Math.abs(n);
                              return abs >= 1000
                                ? `${sign}$${(abs / 1000).toFixed(1)}k`
                                : `${sign}$${abs}`;
                            }}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "#727e75", fontSize: 11 }}
                            width={65}
                          />
                          <Tooltip content={<ChartTip />} />
                          {wall.weeks.map((w, i) =>
                            w.shortfall ? (
                              <ReferenceArea
                                key={w.date}
                                x1={w.label}
                                x2={
                                  wall.weeks[
                                    Math.min(i + 1, wall.weeks.length - 1)
                                  ].label
                                }
                                fill="#e99d87"
                                fillOpacity={0.18}
                              />
                            ) : null,
                          )}
                          <ReferenceLine
                            y={0}
                            stroke="#b86753"
                            strokeDasharray="4 4"
                          />
                          {wall.uncertainty && (
                            <Area
                              isAnimationActive={false}
                              dataKey="band"
                              name="Likely range"
                              type="linear"
                              stroke="none"
                              fill="#1c6551"
                              fillOpacity={0.13}
                              activeDot={false}
                            />
                          )}
                          <Bar
                            isAnimationActive={false}
                            dataKey="payments"
                            name="Payments due"
                            fill="#b9c7a0"
                            radius={[5, 5, 0, 0]}
                            maxBarSize={30}
                          />
                          <Line
                            isAnimationActive={false}
                            dataKey="projected_cash"
                            name="Cash available"
                            type="linear"
                            stroke="#1c6551"
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 5 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <details className="forecast-details">
                      <summary>How we worked this out</summary>
                      <p>
                        On an average day you bring in about{" "}
                        {money(wall.average_daily_net)} after costs, based on
                        the last {wall.average_days ?? 60}{" "}
                        {wall.average_days === 1 ? "day" : "days"} (counting
                        from your first entry, up to 60). We start from the cash
                        you have now, add that each day, and take off each loan
                        payment on its due date. Loan payments you’ve already
                        made aren’t counted twice. Days you don’t log count as
                        zero, so the more you log, the better this gets. We
                        don’t connect to your bank.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Week</th>
                              <th>Loan payments</th>
                              <th>Cash at week’s end</th>
                              <th>Lowest point</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wall.weeks.map((w) => (
                              <tr key={w.date}>
                                <td>{w.label}</td>
                                <td>{money(w.payments)}</td>
                                <td>{money(w.projected_cash)}</td>
                                <td
                                  className={w.shortfall ? "danger-text" : ""}
                                >
                                  {money(w.min_cash ?? w.projected_cash)}
                                  {w.shortfall && <span className="sr-only"> (below zero)</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <form
                      className="cash-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const n = Number(cashInput);
                          if (!Number.isFinite(n) || n < 0)
                            throw new Error(
                              "Cash on hand must be zero or greater.",
                            );
                          await api.cash(n);
                          await load();
                          notify("Cash on hand updated.");
                        });
                      }}
                    >
                      <Field
                        label={
                          DEMO ? "Starting cash ($)" : "Cash on hand today ($)"
                        }
                      >
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)}
                        />
                      </Field>
                      <button className="button outline" disabled={busy}>
                        Update my forecast
                      </button>
                    </form>
                  </section>
                  {loanForm && (
                    <DebtForm
                      // A fresh form for each loan, so switching loans resets the fields
                      key={loanForm === true ? "new" : loanForm.id}
                      initial={loanForm === true ? null : loanForm}
                      averageDailyIncome={Math.max(0, wall.average_daily_net)}
                      busy={busy}
                      onCancel={() => setLoanForm(false)}
                      onSave={async (d) => {
                        setBusy(true);
                        try {
                          if (loanForm === true) await api.debt(d);
                          else await api.updateDebt(loanForm.id, d);
                          setLoanForm(false);
                          await load();
                          notify(loanForm === true ? "Loan added." : "Loan updated.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  <section className="panel">
                    <div className="section-head">
                      <h2>
                        Your loans{" "}
                        <span className="count">{data.debts.length}</span>
                      </h2>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => setLoanForm(true)}
                      >
                        <Plus size={16} />
                        Add loan
                      </button>
                    </div>
                    <div className="loan-grid">
                      {data.debts.map((d) => (
                        <article className="loan-card" key={d.id}>
                          <span className="pill">{d.kind || "Loan"}</span>
                          <h3>{d.lender}</h3>
                          <strong>{money(d.balance)}</strong>
                          <span className="muted">left to pay</span>
                          <div className="loan-meta">
                            <span>
                              {money(d.monthly_payment)} /{" "}
                              {{ weekly: "week", daily: "business day" }[
                                d.payment_frequency
                              ] || "month"}
                            </span>
                            <span>
                              {d.payment_frequency === "daily"
                                ? "Taken every weekday"
                                : d.payment_frequency === "weekly"
                                  ? `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.payment_weekday]}`
                                  : `Due on the ${ordinal(d.payment_day)}`}
                            </span>
                          </div>
                          {Number(d.balloon_amount) > 0 && (
                            <p className="balloon">
                              {money(d.balloon_amount)} final payment ·{" "}
                              {prettyDate(d.balloon_date)}
                            </p>
                          )}
                          <div className="loan-actions">
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => setLoanForm(d)}
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Remove ${d.lender}? Its payments will come off your forecast.`,
                                  )
                                )
                                  return;
                                void run(async () => {
                                  await api.removeDebt(d.id);
                                  if (loanForm?.id === d.id) setLoanForm(false);
                                  await load();
                                  notify("Loan removed.");
                                });
                              }}
                            >
                              <Trash2 size={14} />
                              Remove
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="panel schedule">
                    <h2>Payments coming up</h2>
                    {!wall.payments?.length ? (
                      <p className="muted">
                        No loan payments in the next 90 days.
                      </p>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Due date</th>
                              <th>Lender</th>
                              <th>Payment</th>
                              <th>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wall.payments.map((p, i) => (
                              <tr key={`${p.debt_id}-${p.due_date}-${i}`}>
                                <td>{prettyDate(p.due_date)}</td>
                                <td>{p.lender}</td>
                                <td>{money(p.amount)}</td>
                                <td>
                                  {p.kind === "daily"
                                    ? `Daily, ${p.count} ${p.count === 1 ? "payment" : "payments"}`
                                    : title(p.kind || "monthly")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            <span>Made for the business behind the counter.</span>
            <span>Cashecho</span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {tabs.filter((t) => !(DEMO && t.realOnly)).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
      {(notice || lastSaved) && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>
            {notice || `Saved ${money(lastSaved.amount)} ${lastSaved.type}.`}
          </span>
          {lastSaved && (
            <button disabled={busy} onClick={() => void remove(lastSaved)}>
              <Undo2 size={14} />
              Undo last
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setNotice("");
              setLastSaved(null);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
