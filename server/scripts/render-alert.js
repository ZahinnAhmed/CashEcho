// L7: pre-renders the demo alert to client/public/demo/alert.mp3, which the app
// plays if /api/alert fails during the demo.
// Usage: node scripts/render-alert.js            (uses the text GET /api/alert returns now)
//        node scripts/render-alert.js "Alert text to render"
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { synthesize } = require("../routes/voice");

const API = "http://localhost:3001";
const OUT = path.join(__dirname, "..", "..", "client", "public", "demo", "alert.mp3");

async function alertText() {
  // With Google login on, pass a session token: CASHECHO_TOKEN=... node scripts/render-alert.js
  const token = process.env.CASHECHO_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API}/api/alert`, { headers }).catch(() => {
    throw new Error(`Can't reach ${API}. Start the API (node index.js) or pass the alert text.`);
  });
  if (!res.ok) throw new Error(`GET /api/alert → HTTP ${res.status}. Pass the alert text instead.`);
  return (await res.json()).text;
}

async function main() {
  const text = process.argv.slice(2).join(" ").trim() || (await alertText());
  const audio = await synthesize(text);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, audio);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${Math.round(audio.length / 1024)} KB):\n  "${text}"`);
}

main().catch((err) => {
  console.error(err.cause?.code || err.message);
  process.exit(1);
});
