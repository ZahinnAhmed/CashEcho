import { demo } from "./demo.js";
export const DEMO = import.meta.env.VITE_DEMO_MODE !== "false";
const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
// Friendly text for the voice loop's error codes; error.error keeps the code.
const voiceMessages = {
  no_audio: "No audio reached the server. Please try again.",
  audio_too_large: "That recording was too long. Keep it under a minute.",
  empty_transcript:
    "I didn’t catch any words. Try again closer to the phone, or type it below.",
  transcribe_failed:
    "Voice transcription is unavailable right now. Try again or type it below.",
  parse_failed:
    "I couldn’t turn that into a transaction. Try rephrasing it, or type it below.",
  save_failed: "The transaction wasn’t saved. Please try again.",
};
const TOKEN_KEY = "cashecho-session";
const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session just won't persist */
  }
};
const USER_KEY = "cashecho-user";
// The signed-in person's name, email and picture, kept so the sidebar can show who is logged in
export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};
const setUser = (user) => {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
};
export const hasSession = () => Boolean(getToken());
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...options.headers,
      },
    });
    // The session expired or is invalid: forget it and go back to the login screen
    if (response.status === 401 && getToken()) {
      setToken(null);
      setUser(null);
      window.location.reload();
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(
          voiceMessages[body.error] ||
            body.error ||
            body.message ||
            `Request failed (${response.status}).`,
        ),
        {
          error: body.error,
          fallback: body.fallback === true,
          status: response.status,
        },
      );
    }
    if (response.status === 204) return null;
    return (response.headers.get("content-type") || "").includes(
      "application/json",
    )
      ? response.json()
      : response.blob();
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("The server took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const json = (data) => ({ method: "POST", body: JSON.stringify(data) });
export const api = {
  load: async () => {
    if (DEMO) return demo.load();
    const [t, d, wall, weekly] = await Promise.all([
      request("/transactions"),
      request("/debts"),
      request("/wall"),
      request("/transactions/weekly"),
    ]);
    return {
      weekly,
      transactions: Array.isArray(t) ? t : t.transactions,
      debts: Array.isArray(d) ? d : d.debts,
      wall,
      starting_cash: wall.starting_cash ?? 0,
    };
  },
  parse: async (text) => {
    try {
      const result = DEMO
        ? await demo.parse(text)
        : await request("/parse", json({ text }));
      return { ...(result.transaction || result), raw_text: text };
    } catch (e) {
      throw Object.assign(e, { error: "parse_failed" });
    }
  },
  transcribe: async (blob) => {
    const form = new FormData();
    form.append(
      "audio",
      blob,
      blob.type.includes("mp4") ? "recording.m4a" : "recording.webm",
    );
    try {
      const data = await request("/transcribe", { method: "POST", body: form });
      return data.text || data.transcript;
    } catch (e) {
      e.error ||= "transcribe_failed";
      throw e;
    }
  },
  save: async (t) => {
    try {
      const result = DEMO
        ? await demo.save(t)
        : await request("/transactions", json(t));
      return result.transaction || result;
    } catch (e) {
      throw Object.assign(e, { error: "save_failed" });
    }
  },
  remove: (id) =>
    DEMO
      ? demo.remove(id)
      : request(`/transactions/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
  debt: (d) => (DEMO ? demo.debt(d) : request("/debts", json(d))),
  cash: (v) => demo.cash(v),
  alert: () => request("/alert"),
  speak: (text) => request("/speak", json({ text })),
  reset: () => demo.reset(),
  authConfig: () => request("/auth/config"),
  me: async () => {
    const user = await request("/auth/me");
    setUser(user);
    return user;
  },
  googleLogin: async (credential) => {
    const result = await request("/auth/google", json({ credential }));
    setToken(result.token);
    setUser(result.user);
    return result.user;
  },
  signup: async ({ name, email, password }) => {
    const result = await request("/auth/signup", json({ name, email, password }));
    setToken(result.token);
    setUser(result.user);
    return result.user;
  },
  login: async ({ email, password }) => {
    const result = await request("/auth/login", json({ email, password }));
    setToken(result.token);
    setUser(result.user);
    return result.user;
  },
  logout: () => {
    setToken(null);
    setUser(null);
  },
};
