CashEcho
Voice bookkeeping for small businesses. Say your sales and expenses out loud, ask questions about your own numbers, and see whether your cash will cover your upcoming loan payments.
Built in 48 hours at Hack Knight 2026 (Queens College, Oct 9–11).

Demo
Live app: https://www.cashecho.us
The problem
Many small business owners, like food carts, corner shops, and market stalls, run on cash and don't keep books. They have a loan payment coming up and no clear way to know whether they'll have the money when it's due. Spreadsheets take time they don't have, and many owners are more comfortable speaking than typing, sometimes in a language other than English.
What it does
Log by voice. "Paid $340 for flour" becomes a categorized transaction that the owner confirms before it's saved.
Catch up in one go. "This week we sold 3,200 and spent 1,900 on supplies" becomes entries spread across the right days.
Import receipts. Photos or PDFs of receipts are read into draft transactions.
Ask questions. "How much did we spend last week?", "Who do I spend the most with?", or "Can I afford to order more this month?" get spoken answers from the owner's own data.
The debt wall. Upcoming loan payments next to projected cash, with the chance of running short by each due date.
What-if solver. If a shortfall looks likely, it finds the smallest change that fixes it: more starting cash, moving a balloon payment later, or earning a bit more each day.
Multilingual. Owners can speak in their own language.
How the assistant works
The voice assistant is a tool-using agent. Gemini decides what to do, and my code decides what's true.
owner speaks
   → speech-to-text (ElevenLabs)
   → quick rule check: is this obviously an entry to log?
       yes → parse into a transaction → owner confirms → saved
       no  → Gemini classifies intent and picks one of 11 tools,
             with parameters (time period, category, amount)
   → the tool runs a fixed, parameterized SQL query on the owner's data
   → the answer sentence is built from those numbers
   → text-to-speech (ElevenLabs)
Tools: spend_total, income_total, profit, spend_by_category, top_vendor, cash_on_hand, next_payment, shortfall_risk, debt_coverage, budget_remaining, set_budget
Asking for missing information. If the owner asks "Do I have budget left?" and no budget is set, the assistant asks for it, saves the answer, and then answers the original question.
Design decisions
Gemini never writes SQL and never does arithmetic. This is money, so a confidently wrong number is worse than no answer. The model only chooses from a fixed list of tools and allowed values, enforced with a JSON response schema. Every figure the owner hears comes from a parameterized query, and every sentence is built in code from those figures.
Nothing is saved without the owner confirming it. Voice input can be misheard, so parsed transactions are shown for confirmation first.
Cheap checks before the model. Plain entries like "Paid $340 for flour" are caught with simple rules and skip the classifier. That makes them faster and saves requests.
It shouldn't break during a demo. The Gemini wrapper falls back across several models when one is rate-limited, busy, or retired, with per-model cooldowns and time limits. A hanging model counts as busy, so the owner isn't left waiting.
Forecasts are honest about uncertainty. The shortfall risk is a probability from simulated cash paths based on the owner's history, and early forecasts with little data are flagged as such.
Tech stack
Layer	Technology
Frontend	React, Vite
Backend	Node.js, Express
Database	PostgreSQL (Tiger Data / Timescale for daily totals)
AI	Google Gemini (@google/genai) with structured JSON output
Voice	ElevenLabs speech-to-text and text-to-speech
Auth	Google sign-in and email/password, JWT
Running it locally
bash
# server
cd server
cp .env.example .env   # add GEMINI_API_KEY, ELEVENLABS_API_KEY, DATABASE_URL, Google client ID
npm install
node db/apply-migration.js   # TODO: confirm the exact setup command
npm start

# client
cd client
npm install
npm run dev
Team
Zahin Ahmed: backend (API, database schema, transactions, forecast and debt wall, what-if solver), the Gemini assistant and parsing, product planning
Labib Ahmed: voice layer (ElevenLabs speech-to-text and text-to-speech)
Parsa: frontend design, logo, and navigation
What's next
Multi-step reasoning. When shortfall_risk finds a likely shortfall, the agent goes on to run the what-if solver and suggests a fix in the same answer.
Native function calling in place of the classify-then-route step.
Proactive alerts. Warn the owner a week before a payment they're likely to miss.
An evaluation set of real spoken questions to measure how often the assistant picks the right tool.
