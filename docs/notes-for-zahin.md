# Voice layer → backend: notes for Zahin

From Labib. My branch `labib/voice-layer` (not pushed yet) combines your `server-backend` work, Parsa's frontend and the voice layer (tickets L1–L7). Your backend already covered most of what I was going to ask for: CORS, `raw_text`, `YYYY-MM-DD` dates, numeric amounts and JSON-mode parsing.

## The one change in your files

`server/index.js` mounts the voice routes after your parse route:

```js
app.use('/api', require('./routes/voice').router); // /api/transcribe, /api/speak
```

The router brings its own multer and JSON parser, so where it's mounted doesn't matter. I tested `/api/transcribe` and `/api/speak` inside your server, and your routes still answer. Nothing else in your files changed.

Also on my branch:

- **`server/package.json`** adds `multer`, the only new dependency, and the scripts `stt:smoke` and `voice:eval`.
- **`server/.env.example`** lists all four server keys: `DATABASE_URL`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
- **New files (mine):** `routes/voice.js`, `scripts/stt-smoke.js`, `scripts/voice-eval.js`, `scripts/render-alert.js`, `test/voice-cases.json` and `test/audio/`.

## Found in a live test (Oct 9, real keys)

Your database connected, ElevenLabs speech and transcription worked, and `/api/wall` loaded. Three things came up:

- **Gemini returned `503 UNAVAILABLE`** ("This model is currently experiencing high demand") on every `/api/parse` call for several minutes. Your key is fine; this is Google's capacity.
  - Both of your retries fire immediately, so they hit the same spike.
  - A short backoff (about a second) on 503, plus a fallback model on the second try (for example a Flash-Lite model), would keep the demo alive through a spike.
- **ElevenLabs writes some spoken amounts as cents.**

  | Said | Transcript |
  | --- | --- |
  | "three forty" | "$3.40" |
  | "six fifty" | "$6.50" |
  | "four eighty" | "480" (correct) |
  | "five twenty" | "520" (correct) |
  | "Sysco" | "Cisco" |

  So the prompt has to fix "$3.40" itself; see rule 2 below. In the demo, I'll say "three hundred forty dollars", which transcribes cleanly as "$340".
- **The database is empty** (0 transactions, 0 debts). The demo needs `node db/seed.js`. I didn't run it, since it's your database.

## What I need from you

1. **Deployed environment.** Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` next to your two keys; I'll send the values privately.
   - The backend needs Node 18+ for built-in `fetch` and `FormData`.
   - Most hosts assign the port through `PORT`, so consider `app.listen(process.env.PORT || 3001, ...)` instead of a hardcoded 3001.
2. **`/api/alert`.** It isn't in your branch yet. When you add it, the patch below gives it a voice.
   - For the seeded account, keep the alert text the same on every call: temperature 0, or cache it for the same inputs.
   - That way the backup `client/public/demo/alert.mp3`, which I pre-render from your text, matches what the live alert says.
3. **Parse prompt.** Try the additions below, then run `npm run voice:eval` in `server/`. We need 16 of the 18 cases to pass; three of them are real transcripts with the "$3.40" problem.

## Voice endpoints (as agreed)

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/api/transcribe` | multipart, field `audio` (webm or mp4, up to 10 MB) | `200 { text }` | `400 no_audio`, `413 audio_too_large`, `422 empty_transcript`, `502 { error: "transcribe_failed", fallback: true }` |
| POST | `/api/speak` | JSON `{ text }`, cut to 600 characters | `200`, body is `audio/mpeg` | `400 no_text`, `502 speak_failed` |

- **The `413` is the only addition** to what we agreed.
- **Timeouts:** calls to ElevenLabs time out after 15 s.
- **Logs:** lines start with `[voice]` and never include the key.

## Helpers you can import (CommonJS)

```js
const { synthesize, synthesizeDataUrl, confirmationLine } = require("./routes/voice");

await synthesize(text);        // → Buffer (mp3)
await synthesizeDataUrl(text); // → "data:audio/mpeg;base64,..."
confirmationLine(tx);          // → "Logged $340 expense, supplies."
```

Both synth functions share an in-memory cache keyed by the text, so a repeated alert doesn't spend credits.

## Suggested `/api/alert` patch (apply only if you agree)

```js
const { synthesizeDataUrl } = require("./voice");

// after Gemini writes `text`:
let audioUrl = null;
try {
  audioUrl = await synthesizeDataUrl(text);
} catch (err) {
  console.error("[alert] TTS failed:", err.message);
}
res.json({ text, audioUrl });
```

The client plays `audioUrl`; it also accepts `audio_url`. When `audioUrl` is `null`, it speaks `text`. If `/api/alert` fails entirely, it plays `/demo/alert.mp3`.

## Parse prompt: suggested additions

Your prompt, schema, validation and retry already cover the format. These additions come from how a cart owner actually talks, and `npm run voice:eval` checks them against `server/test/voice-cases.json`.

1. **Use the cart's timezone for "today".** `todayKey()` uses the server's clock, so on a UTC host "today" turns into tomorrow after 8 pm Eastern. One fix:
   ```js
   const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
   ```
2. **Spoken numbers are dollars:**
   - "three forty" = 340
   - "four eighty" = 480
   - "six fifty" = 650
   - "eighty seven fifty" = 87.50
   - "a buck fifty" = 1.50
   - "a hundred twenty bucks" = 120

   "About" or "around" X means X.

   The transcript comes from speech-to-text, which writes "three forty" as "$3.40" and "six fifty" as "$6.50". Tell the model: if a single-digit amount with cents is implausibly small for what it's paying for (bulk supplies, a day's sales, rent, a loan payment), read it as the whole number: "$3.40" → 340, "$6.50" → 650. Real small amounts like "a buck fifty" for ice stay as they are. The confirm card is the safety net, since the owner can edit the amount before saving.
3. **Category hints:**
   - food, ingredients, napkins, foil, ice and propane refills → `supplies`
   - durable items (a new tank, a grill, cart parts) → `equipment`
   - paying a helper or staff → `payroll`
   - the commissary or a parking spot "for rent" → `rent`
4. **Payment words:**
   - card, debit, credit, Square or tap → `card`
   - Zelle, Cash App, Venmo or check → `other`

   Your prompt uses `other` when nothing is said. For a food cart, `cash` may be the better default; that's your call.
5. **Vendor names** in Title Case, as spoken: Restaurant Depot, Jetro, Sysco, Commissary, SBA. Speech-to-text writes "Sysco" as "Cisco", so list that too: a food cart's "Cisco delivery" is Sysco.
6. **Few-shot examples**, which help most with the spoken numbers:

```
"Restaurant Depot, three forty, flour and oil, paid cash"
→ {"is_transaction":true,"type":"expense","amount":340,"category":"supplies","vendor":"Restaurant Depot","payment_method":"cash","date":"<today>","note":"flour and oil"}

"Zelle'd the commissary 600 for rent"
→ {"is_transaction":true,"type":"expense","amount":600,"category":"rent","vendor":"Commissary","payment_method":"other","date":"<today>","note":"rent"}

"Sold 40 gyros, about 480 cash"
→ {"is_transaction":true,"type":"income","amount":480,"category":"sales","vendor":null,"payment_method":"cash","date":"<today>","note":"40 gyros"}

"Picked up napkins and foil at Jetro, eighty seven fifty on the card"
→ {"is_transaction":true,"type":"expense","amount":87.5,"category":"supplies","vendor":"Jetro","payment_method":"card","date":"<today>","note":"napkins and foil"}
```

To check the prompt, run `npm run voice:eval` against your local server, or `npm run voice:eval -- https://<deployed-api>` against the deployed one. It prints a pass/fail line per case and which fields fail most. Each run makes 18 Gemini calls, so if you see `HTTP 429` or `502`, wait a minute and run it again.
