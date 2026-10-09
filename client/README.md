# Cartwise — Parsa's Hack Knight frontend

A mobile-first React frontend for Voice Ledger + Debt Wall. Includes P1–P8, Vercel configuration for P9, and a printable Debt Wall summary for P10. This is the `/client` portion only: no API keys, backend, database or sponsor accounts are included. The app is not deployed yet; domain registration and pointing require the team’s domain/hosting access.

## Run

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

Open the URL Vite prints. Demo mode is on by default. It seeds 90 days of transactions and three loans, saves changes in localStorage, and includes a balloon shortfall. Use **Reset demo** to restore the data. Browser speech recognition varies by browser and may require a network connection; Chrome is a good demo target. Typed and manual entry always work. Voice demo uses browser speech synthesis and a deliberately simple parser, not sponsor APIs.

```bash
npm test
npm run build
npm run preview
```

## Connect the team's backend

Set `.env`, then restart Vite:

```dotenv
VITE_DEMO_MODE=false
VITE_API_BASE_URL=http://localhost:3001
```

Alternatively, omit `VITE_API_BASE_URL` to proxy `/api` to `localhost:3001` during development. Set the production backend URL in Vercel's environment variables before building. The backend must permit CORS from your frontend origin. Never put Gemini, ElevenLabs, or database secrets in any `VITE_` variable: these are public browser configuration.

API wrappers are in `client/src/api.js`. The PRD specifies routes but not all response shapes; this client establishes the contract below. Coordinate it with Zahin and Labib, or change the wrapper to match their implementation. API mode uses the backend forecast; the frontend calculation is demo-only.

| Request                                                                                 | Expected response                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /api/transcribe`, multipart field `audio` (WebM/Opus or MP4 depending on browser) | `{ "text": "Paid $340 for flour at Restaurant Depot" }`                                   |
| `POST /api/parse`, `{ "text": "..." }`                                                  | PRD transaction object, or `{ "transaction": {...} }`                                     |
| `GET /api/transactions`                                                                 | Array of transactions, or `{ "transactions": [...] }`                                     |
| `POST /api/transactions`, transaction object plus `raw_text`                            | Saved transaction with `id`, or `{ "transaction": {...} }`                                |
| `DELETE /api/transactions/:id`                                                          | HTTP 204 or JSON acknowledgment (PRD omits the exact delete URL; agree this with Zahin)   |
| `GET /api/debts`                                                                        | Array of debts, or `{ "debts": [...] }`                                                   |
| `POST /api/debts`, debt object                                                          | JSON acknowledgment or saved debt                                                         |
| `GET /api/wall`                                                                         | Forecast object shown below                                                               |
| `GET /api/alert`                                                                        | `{ "text": "...", "audio_url": "https://..." }`; without audio URL, client calls `/speak` |
| `POST /api/speak`, `{ "text": "..." }`                                                  | Audio Blob response (`audio/mpeg` etc.), or `{ "audio_url": "https://..." }`              |

Example forecast response (dates should be generated relative to the demo):

```json
{
  "starting_cash": 2400,
  "average_daily_net": 30,
  "weeks": [
    {
      "date": "2026-10-09",
      "label": "Oct 9",
      "payments": 520,
      "projected_cash": 2090,
      "min_cash": 2000,
      "shortfall": false
    }
  ],
  "payments": [
    {
      "debt_id": "sba",
      "lender": "SBA business loan",
      "due_date": "2026-10-10",
      "amount": 520,
      "kind": "monthly"
    }
  ],
  "first_shortfall": {
    "lender": "Cart equipment financing",
    "due_date": "2026-11-13",
    "amount": 5500,
    "shortfall": 850
  }
}
```

Use `first_shortfall: null` if covered. `weeks` should contain 13 weekly points spanning 90 days. Cash values are **after** deducting scheduled payments. Supply `min_cash` and `shortfall` based on daily cash, so early-week negative balances remain flagged even if the week recovers. The bar shows payments; the line shows week-ending cash. `payments` is the complete date-ordered 90-day schedule.

Transactions use the PRD categories: `sales`, `supplies`, `rent`, `payroll`, `equipment`, `loan_payment`, `other`. Amounts are positive, with `type` determining the sign. Dates are `YYYY-MM-DD`. Debt objects use the PRD columns, including `payment_day`, `balloon_amount` and `balloon_date`. IDs must be stable and unique.

## Features and files

- `src/App.jsx`: Log, Ledger, Debt Wall; edit-before-confirm; discard and undo; weekly totals and search; debt form; chart tooltips and accessible table; written and spoken alert; print summary.
- `src/useRecorder.js`: permission handling, MediaRecorder format negotiation, idle/starting/recording/sending states, 60-second cap, browser speech fallback, stream cleanup.
- `src/api.js`: centralized API contract, 30-second request timeouts, multipart audio and audio playback responses.
- `src/demo.js`: local seeded data and demo parsing. An API failure does not silently switch to demo mode.
- `src/model.js`: demo daily cash calculation and schedule generation. Excludes historical `loan_payment` entries from the operating average, deducts future payments once, and clamps month-end dates. Assumes monthly servicing, even for the sample MCA; it does not implement real daily/weekly MCA terms or amortization.
- `src/styles.css`: responsive styling and Tailwind setup, keyboard focus states, reduced motion, mobile navigation, print CSS.
- `tests/model.test.js`: meaningful tests of date boundaries, debt double counting, intraweek shortfalls and validation.

The demo operating average includes today, so confirmed entries update the forecast immediately. Starting cash is editable only in demo mode; the PRD has no endpoint for editing it. In API mode, `/api/wall` must provide it. The print summary uses already loaded data and does not need `/api/summary`; it is a lightweight stretch feature, not an underwriting document.

## Suggested demo

1. Type or speak “Paid $340 for flour at Restaurant Depot.”
2. Review the card and confirm. Try **Undo last** once.
3. Open Ledger, filter entries, and inspect weekly totals.
4. Open Debt Wall, hover the chart, and hear the shortfall alert.
5. Raise starting cash in demo mode to show the red risk zone disappear.
6. Add a loan to show its schedule appear, then reset for judging.

## Deployment

In Vercel, import the team repo, set **Root Directory** to `client`, use the Vite preset, and set build command `npm run build` and output directory `dist`. Add the production environment variables above. Deploy the backend first, then verify CORS, audio capture and playback over HTTPS on a real phone. Add the team's GoDaddy domain in Vercel and apply the DNS records Vercel supplies. The frontend cannot register or configure the team's domain without account access.

## Before merging

Run the build and tests. Check the team's API response shapes, multipart audio field and DELETE path. Verify microphone capture and ElevenLabs playback on the deployed HTTPS URL; mobile autoplay rules may require tapping **Hear alert**. Run the 3-minute demo on a phone. All buttons work in demo mode without paid APIs, but sponsor integration requires the team's working backend.
