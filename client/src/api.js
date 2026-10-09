import { demo } from "./demo.js";
export const DEMO = import.meta.env.VITE_DEMO_MODE !== "false";
const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
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
        ...options.headers,
      },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error || error.message || `Request failed (${response.status}).`,
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
    const [t, d, wall] = await Promise.all([
      request("/transactions"),
      request("/debts"),
      request("/wall"),
    ]);
    return {
      transactions: Array.isArray(t) ? t : t.transactions,
      debts: Array.isArray(d) ? d : d.debts,
      wall,
      starting_cash: wall.starting_cash ?? 0,
    };
  },
  parse: async (text) => {
    const result = DEMO
      ? await demo.parse(text)
      : await request("/parse", json({ text }));
    return { ...(result.transaction || result), raw_text: text };
  },
  transcribe: async (blob) => {
    const form = new FormData();
    form.append(
      "audio",
      blob,
      blob.type.includes("mp4") ? "recording.m4a" : "recording.webm",
    );
    const data = await request("/transcribe", { method: "POST", body: form });
    return data.text || data.transcript;
  },
  save: async (t) => {
    const result = DEMO
      ? await demo.save(t)
      : await request("/transactions", json(t));
    return result.transaction || result;
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
};
