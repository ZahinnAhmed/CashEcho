// L6: runs test/voice-cases.json through /api/parse (audio cases go through
// /api/transcribe first) and checks each field against what we expect.
// Usage: npm run voice:eval [-- https://your-api-url]
// With Google login on, pass a session token: CASHECHO_TOKEN=... npm run voice:eval
const fs = require("node:fs");
const path = require("node:path");

const API = (process.argv[2] || "http://localhost:3001").replace(/\/$/, "");
const AUTH = process.env.CASHECHO_TOKEN
  ? { Authorization: `Bearer ${process.env.CASHECHO_TOKEN}` }
  : {};
const CASES = path.join(__dirname, "..", "test", "voice-cases.json");
const AUDIO_DIR = path.join(__dirname, "..", "test", "audio");
const PASS_RATE = 13 / 15;
const AUDIO_TYPES = {
  ".webm": "audio/webm",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

// "today" / "yesterday" mean the cart's calendar day, not UTC.
const DAYS_AGO = { today: 0, yesterday: 1 };
const nyDate = (daysAgo) =>
  new Date(Date.now() - daysAgo * 86400000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
const resolve = (field, want) =>
  field === "date" && want in DAYS_AGO ? nyDate(DAYS_AGO[want]) : want;

const loose = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function matches(field, want, got) {
  if (field === "amount") return Math.abs(Number(got) - want) < 0.005;
  // Vendor and note pass if one contains the other: "commissary" vs "The Commissary".
  if (field === "vendor" || field === "note") {
    const [w, g] = [loose(want), loose(got)];
    return g !== "" && (g.includes(w) || w.includes(g));
  }
  // Enums and dates must match the locked schema exactly.
  return got === resolve(field, want);
}

async function post(route, body) {
  const json = !(body instanceof FormData);
  const res = await fetch(`${API}/api${route}`, {
    method: "POST",
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...AUTH },
    body: json ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status} ${data.error || ""}`.trim());
  return data;
}

async function transcribe(clip) {
  const file = path.join(AUDIO_DIR, clip);
  const type = AUDIO_TYPES[path.extname(clip).toLowerCase()];
  const form = new FormData();
  form.append("audio", new Blob([fs.readFileSync(file)], { type }), clip);
  return (await post("/transcribe", form)).text;
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(CASES, "utf8"));
  const needed = Math.ceil(cases.length * PASS_RATE);
  const failsByField = {};
  let passed = 0;
  console.log(`Running ${cases.length} cases against ${API}\n`);

  for (const [i, c] of cases.entries()) {
    const problems = [];
    let heard;
    try {
      const text = c.audio ? (heard = await transcribe(c.audio)) : c.say;
      const result = await post("/parse", { text });
      const tx = result.transaction || result;
      for (const [field, want] of Object.entries(c.expect)) {
        if (matches(field, want, tx[field])) continue;
        failsByField[field] = (failsByField[field] || 0) + 1;
        problems.push(
          `${field}: want ${JSON.stringify(resolve(field, want))}, got ${JSON.stringify(tx[field])}`,
        );
      }
    } catch (err) {
      failsByField.request = (failsByField.request || 0) + 1;
      problems.push(err.cause?.code || err.message);
    }
    if (!problems.length) passed++;
    const n = String(i + 1).padStart(2);
    console.log(`${n} ${problems.length ? "FAIL" : "pass"}  ${c.audio ? `[${c.audio}]` : c.say}`);
    if (heard !== undefined) console.log(`         heard: ${heard}`);
    for (const p of problems) console.log(`         ${p}`);
  }

  const worst = Object.entries(failsByField)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => `${field} ×${count}`)
    .join(", ");
  console.log(`\n${passed}/${cases.length} passed (need ${needed}).${worst ? ` Failing fields: ${worst}` : ""}`);
  process.exit(passed >= needed ? 0 : 1);
}

main();
