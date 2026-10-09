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
  Leaf,
  CalendarSync,
} from "lucide-react";
import {
  ComposedChart,
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
import { api, DEMO } from "./api.js";
import {
  categories,
  dateKey,
  addDays,
  money,
  prettyDate,
  weeklyTotals,
  validateTransaction,
  validateDebt,
  registerAccount,
  loginAccount,
} from "./model.js";
import { useRecorder } from "./useRecorder.js";

const tabs = [
  { id: "log", label: "Log money", icon: Mic },
  { id: "ledger", label: "Ledger", icon: BookOpen },
  { id: "wall", label: "Debt Wall", icon: ChartNoAxesCombined },
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
  end_date: dateKey(addDays(new Date(), 365)),
  balloon_amount: 0,
  balloon_date: "",
});
const title = (s) =>
  s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const USERS_KEY = "cashecho-users";
const CURRENT_USER_KEY = "cashecho-current-user";

function readSavedUsers() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function readCurrentUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function decodeGoogleJwt(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
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
      <p>Payments: {money(row.payments)}</p>
      <p>Ending cash: {money(row.projected_cash)}</p>
      <p>Lowest daily cash: {money(row.min_cash ?? row.projected_cash)}</p>
      {row.shortfall && <b className="danger-text">Shortfall expected</b>}
    </div>
  );
}
function DebtForm({ onSave, onCancel, busy }) {
  const [value, setValue] = useState(blankDebt),
    [error, setError] = useState("");
  const update = (k) => (e) => setValue({ ...value, [k]: e.target.value });
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
    <form onSubmit={submit} className="panel debt-form">
      <div className="section-head">
        <h2>Add a loan</h2>
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
        <Field label="Lender">
          <input
            required
            value={value.lender}
            onChange={update("lender")}
            placeholder="SBA business loan"
          />
        </Field>
        <Field label="Loan type">
          <select value={value.kind} onChange={update("kind")}>
            {["SBA", "Equipment", "MCA", "Other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Outstanding balance ($)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.balance}
            onChange={update("balance")}
          />
        </Field>
        <Field label="Monthly payment ($)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.monthly_payment}
            onChange={update("monthly_payment")}
          />
        </Field>
        <Field label="Annual rate (%)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value.rate_pct}
            onChange={update("rate_pct")}
          />
        </Field>
        <Field label="Payment day of month">
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
        <Field label="Loan end date">
          <input
            required
            type="date"
            min={dateKey()}
            value={value.end_date}
            onChange={update("end_date")}
          />
        </Field>
        <Field label="Balloon payment ($, optional)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.balloon_amount}
            onChange={update("balloon_amount")}
          />
        </Field>
        {Number(value.balloon_amount) > 0 && (
          <Field label="Balloon due date">
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
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Save loan"}
        <Check size={17} />
      </button>
    </form>
  );
}
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(readCurrentUser()));
  const [currentUser, setCurrentUser] = useState(readCurrentUser);
  const [googleUser, setGoogleUser] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ name: "", email: "", password: "" });
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
  const audioRef = useRef(null),
    urlRef = useRef(null),
    toastTimer = useRef(null);
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
      setCashInput(String(result.starting_cash));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      window.speechSynthesis?.cancel();
      clearTimeout(toastTimer.current);
    };
  }, []);
  function notify(message) {
    setNotice(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(""), 6000);
  }
  function handleLoginSubmit(event) {
    event.preventDefault();
    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      setError("Please enter both your email and password.");
      return;
    }
    try {
      const users = readSavedUsers();
      const account = loginAccount(users, {
        email: loginForm.email,
        password: loginForm.password,
      });
      setCurrentUser(account);
      setIsLoggedIn(true);
      setError("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(account));
      }
    } catch (e) {
      setError(e.message || "Unable to log in.");
    }
  }
  function handleSignupSubmit(event) {
    event.preventDefault();
    if (!signupForm.name.trim() || !signupForm.email.trim() || !signupForm.password.trim()) {
      setError("Please fill in your name, email, and password.");
      return;
    }
    try {
      const users = readSavedUsers();
      const account = registerAccount(users, signupForm);
      const signedUpUser = account[account.length - 1];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(USERS_KEY, JSON.stringify(account));
        window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(signedUpUser));
      }
      setCurrentUser(signedUpUser);
      setIsLoggedIn(true);
      setError("");
      setSignupForm({ name: "", email: "", password: "" });
      setLoginForm({ email: signedUpUser.email, password: "" });
      setAuthMode("login");
    } catch (e) {
      setError(e.message || "Unable to create your account.");
    }
  }
  function handleLogout() {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setGoogleUser(null);
    setError("");
    setAuthMode("login");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_USER_KEY);
    }
  }
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === "undefined") return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            const payload = decodeGoogleJwt(response.credential);
            if (!payload) {
              setError("Google sign-in failed. Please try again.");
              return;
            }
            setGoogleUser({
              name: payload.name || payload.email || "Google user",
              email: payload.email || "",
              picture: payload.picture || "",
            });
            setError("");
            setIsLoggedIn(true);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  async function handleGoogleCalendarSync() {
    if (!GOOGLE_CLIENT_ID) {
      setError("Add VITE_GOOGLE_CLIENT_ID to your .env file before enabling Google Calendar sync.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setError("Google calendar access is not ready yet. Try again in a moment.");
      return;
    }

    setCalendarSyncing(true);
    setError("");

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            throw new Error(tokenResponse.error_description || "Calendar access was denied.");
          }

          const response = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=10",
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.access_token}`,
              },
            },
          );

          if (!response.ok) {
            throw new Error("Unable to load Google Calendar events.");
          }

          const data = await response.json();
          setCalendarEvents(data.items || []);
          setNotice("Google Calendar synced.");
        },
      });

      tokenClient.requestAccessToken();
    } catch (e) {
      setError(e.message || "Calendar sync failed.");
    } finally {
      setCalendarSyncing(false);
    }
  }

  function handleGoogleLogin() {
    if (!GOOGLE_CLIENT_ID) {
      setError("Google sign-in is disabled until VITE_GOOGLE_CLIENT_ID is configured.");
      return;
    }
    if (!window.google?.accounts?.id) {
      setError("Google auth is still loading. Please try again in a moment.");
      return;
    }
    window.google.accounts.id.prompt();
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
  async function parse(textValue) {
    const value = await api.parse(textValue);
    setDraft(validateTransaction(value));
    setManual(false);
    setText(textValue);
  }
  const recorder = useRecorder(parse, setError);
  async function playAudio(source) {
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const url =
      source instanceof Blob
        ? (urlRef.current = URL.createObjectURL(source))
        : source;
    if (!url) throw new Error("The voice API returned no audio.");
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      setError("Could not play the audio. Try again.");
    };
    try {
      await audio.play();
    } catch (e) {
      setPlaying(false);
      throw e;
    }
  }
  async function say(textValue) {
    if (DEMO) {
      if (!window.speechSynthesis)
        throw new Error("Speech playback is unavailable in this browser.");
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textValue);
      utterance.rate = 0.94;
      utterance.onend = () => setPlaying(false);
      utterance.onerror = () => setPlaying(false);
      setPlaying(true);
      speechSynthesis.speak(utterance);
      return;
    }
    const result = await api.speak(textValue);
    await playAudio(
      result instanceof Blob ? result : result.audio_url || result.audioUrl,
    );
  }
  async function save(e) {
    e.preventDefault();
    await run(async () => {
      const saved = await api.save(validateTransaction(draft));
      setLastSaved(saved);
      setDraft(null);
      setText("");
      setManual(false);
      await load();
      notify(`Logged ${money(saved.amount)} ${saved.type}.`);
      try {
        await say(
          `Logged ${money(saved.amount)} ${saved.type}, ${title(saved.category)}.`,
        );
      } catch {
        notify("Transaction saved. Voice playback is unavailable.");
      }
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
  const weeks = weeklyTotals(transactions),
    currentWeek = weeks.find((w) => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return w.date === dateKey(d);
    }) || { income: 0, expenses: 0 };
  const wall = data?.wall,
    shortfall = wall?.first_shortfall;
  const alertText = shortfall
    ? `${shortfall.lender} has a ${money(shortfall.amount)} payment due ${prettyDate(shortfall.due_date)}. Based on your current cash and recent activity, you are projected to be ${money(shortfall.shortfall)} short. Review the payment schedule and your upcoming income.`
    : "Your projected cash covers the scheduled payments over the next 90 days. Keep logging transactions to update the forecast.";
  async function playAlert() {
    await run(async () => {
      if (playing) {
        audioRef.current?.pause();
        window.speechSynthesis?.cancel();
        setPlaying(false);
        return;
      }
      if (DEMO) await say(alertText);
      else {
        const result = await api.alert();
        if (result.audio_url || result.audioUrl)
          await playAudio(result.audio_url || result.audioUrl);
        else await say(result.text || result.alert_text || alertText);
      }
    });
  }
  if (!isLoggedIn) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">
            <span className="brand-symbol login-icon">
              <Leaf size={22} />
            </span>
            <span>Cashecho</span>
          </div>
          <p className="login-subtitle">
            {authMode === "login"
              ? "Sign in to manage cash flow, debt planning, and daily spending."
              : "Create an account to save your business cash plan and sign back in later."}
          </p>
          <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
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
              <button type="submit" className="button primary login-button">
                Log in
              </button>
              <button
                type="button"
                className="google-button"
                onClick={handleGoogleLogin}
              >
                Continue with Google
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
                    setSignupForm({ ...signupForm, password: event.target.value })
                  }
                  placeholder="At least 6 characters"
                />
              </label>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="button primary login-button">
                Create account
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("log");
          }}
        >
          <span className="brand-symbol">
            <Leaf size={24} />
          </span>
          Cashecho<span className="brand-dot">.</span>
        </a>
        <p className="sidebar-label">YOUR BUSINESS, IN VIEW</p>
        <nav aria-label="Main navigation">
          {tabs.map(({ id, label, icon: Icon }) => (
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
            <Leaf size={18} />
          </span>
          <h3>Small cart. Big picture.</h3>
          <p>A little clarity for the business you’re building.</p>
        </div>
        <div className="business">
          <span className="avatar">QC</span>
          <div>
            <strong>Cashecho</strong>
            <span>{DEMO ? "Demo business" : "Business workspace"}</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            <span className="status-dot" />
            {DEMO ? "Interactive demo" : "Connected to your team API"}
          </span>
          <div className="top-actions">
            {currentUser && <span className="user-badge">{currentUser.name}</span>}
            {googleUser && (
              <button
                className="button outline sync-button"
                disabled={calendarSyncing || busy}
                onClick={() => void handleGoogleCalendarSync()}
              >
                <CalendarSync size={14} />
                {calendarSyncing
                  ? "Syncing…"
                  : calendarEvents.length
                    ? "Sync calendar"
                    : "Sync Google Calendar"}
              </button>
            )}
            <button className="text-button" onClick={handleLogout}>
              Log out
            </button>
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
            {googleUser && (
              <button
                className="text-button"
                onClick={() => {
                  setGoogleUser(null);
                  setCalendarEvents([]);
                  setIsLoggedIn(false);
                }}
              >
                Log out
              </button>
            )}
            <span className="date-label">
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
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
                    : "LOOK AHEAD WITH CONFIDENCE."}
              </p>
              <h1>
                {tab === "log"
                  ? "Your money. In your words."
                  : tab === "ledger"
                    ? "The story behind your numbers."
                    : "See the squeeze before it hits."}
              </h1>
              <p>
                {tab === "log"
                  ? "Say a sale or an expense. We’ll take care of the entry."
                  : tab === "ledger"
                    ? "A clear record of what comes in and what goes out."
                    : "Your next 90 days of cash and loan payments, together."}
              </p>
            </div>
            {tab === "wall" && (
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
                    {tab === "wall" ? "Starting cash" : "This week’s net cash"}
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
                      ? "Available at the start of the forecast"
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
                          ? "Tap again when you’re done."
                          : "“Paid $340 for flour at Restaurant Depot.”"}
                      </span>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={recorder.fallback}
                        disabled={recorder.status !== "idle"}
                        onChange={(e) => recorder.setFallback(e.target.checked)}
                      />
                      Use browser speech recognition{" "}
                      {DEMO && <span>(demo)</span>}
                    </label>
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
                        placeholder="Received $650 in sales today"
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
                    {calendarEvents.length > 0 && (
                      <div className="google-calendar-box">
                        <h3>Google Calendar sync</h3>
                        <ul>
                          {calendarEvents.slice(0, 4).map((event) => (
                            <li key={event.id}>
                              <strong>{event.summary || "Untitled event"}</strong>
                              <span>
                                {event.start?.dateTime
                                  ? new Date(event.start.dateTime).toLocaleString()
                                  : event.start?.date || "All day"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
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
              {tab === "wall" && (
                <>
                  <section
                    className={`alert-banner ${shortfall ? "risk" : "safe"}`}
                  >
                    <TriangleAlert size={25} />
                    <div>
                      <h2>
                        {shortfall
                          ? `${money(shortfall.shortfall)} projected shortfall`
                          : "Scheduled payments covered"}
                      </h2>
                      <p>{alertText}</p>
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
                  <section className="panel wall-panel">
                    <div className="section-head">
                      <div>
                        <h2>The next 90 days</h2>
                        <p className="muted">
                          Cash after scheduled payments. Red marks a week with
                          negative cash.
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
                      </div>
                    </div>
                    <div
                      className="chart-container"
                      role="img"
                      aria-label="90-day cash forecast with scheduled payments and red shortfall weeks"
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
                            tickFormatter={(n) =>
                              Math.abs(n) >= 1000
                                ? `$${(n / 1000).toFixed(1)}k`
                                : `$${n}`
                            }
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
                      <summary>Forecast assumptions and weekly numbers</summary>
                      <p>
                        Average daily operating cash:{" "}
                        {money(wall.average_daily_net)}. Uses the last 60
                        calendar days including today, excludes historical loan
                        payments, and subtracts scheduled payments once. Assumes
                        steady activity; missing entries affect the forecast. No
                        bank connection. Demo loan schedules use monthly
                        payments, including the sample merchant cash advance.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Week</th>
                              <th>Payments</th>
                              <th>Ending cash</th>
                              <th>Lowest cash</th>
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
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    {DEMO && (
                      <form
                        className="cash-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            const n = Number(cashInput);
                            if (!Number.isFinite(n) || n < 0)
                              throw new Error(
                                "Starting cash must be zero or greater.",
                              );
                            await api.cash(n);
                            await load();
                            notify("Starting cash updated.");
                          });
                        }}
                      >
                        <Field label="Starting cash ($)">
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
                          Update forecast
                        </button>
                      </form>
                    )}
                  </section>
                  {loanForm && (
                    <DebtForm
                      busy={busy}
                      onCancel={() => setLoanForm(false)}
                      onSave={async (d) => {
                        setBusy(true);
                        try {
                          await api.debt(d);
                          setLoanForm(false);
                          await load();
                          notify("Loan added.");
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
                          <span className="muted">outstanding balance</span>
                          <div className="loan-meta">
                            <span>{money(d.monthly_payment)} / month</span>
                            <span>Due day {d.payment_day}</span>
                          </div>
                          {Number(d.balloon_amount) > 0 && (
                            <p className="balloon">
                              {money(d.balloon_amount)} balloon ·{" "}
                              {prettyDate(d.balloon_date)}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="panel schedule">
                    <h2>Upcoming payments</h2>
                    {!wall.payments?.length ? (
                      <p className="muted">
                        No payments scheduled in this forecast.
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
                                <td>{title(p.kind || "monthly")}</td>
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
            <Leaf size={14} />
            <span>Made for the business behind the counter.</span>
            <span>Cartwise · Hack Knight</span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {tabs.map(({ id, label, icon: Icon }) => (
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
