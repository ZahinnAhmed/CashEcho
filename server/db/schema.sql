-- ============================================================
-- TABLE 0: users
-- One row per Google account that has signed in. Every other table points at it.
-- ============================================================
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  picture       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- TABLE 1: transactions
-- Every sale or expense the owner says out loud becomes one row.
-- ============================================================
CREATE TABLE transactions (
  -- Whose transaction this is; deleting a user deletes their data
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Row number that counts up by itself. You never type it.
  id             SERIAL,

  -- When the sale or expense happened. DEFAULT now() fills in the current time.
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Money in or out. CHECK rejects anything except these two words.
  type           TEXT NOT NULL CHECK (type IN ('income','expense')),

  -- Dollar amount. NUMERIC is exact, unlike floats (0.1 + 0.2 != 0.3).
  amount         NUMERIC(10,2) NOT NULL,

  -- Kind of money: sales, supplies, rent, etc. Used to group spending.
  category       TEXT NOT NULL,

  -- Who was paid or who paid ("Restaurant Depot"). Optional.
  vendor         TEXT,

  -- cash, card, or other. Optional.
  payment_method TEXT,

  -- Extra detail ("flour"). Optional.
  note           TEXT,

  -- The exact words the owner spoke, for checking the parser's work.
  raw_text       TEXT,

  -- When we saved the row (can differ from occurred_at if logged late).
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Tiger Data requires the time column to be part of the primary key.
  PRIMARY KEY (id, occurred_at)
);

-- Turns the table into a time-series table split into chunks by date,
-- so "total per week" queries stay fast.
SELECT create_hypertable('transactions', 'occurred_at');
CREATE INDEX transactions_user_idx ON transactions (user_id, occurred_at DESC);


-- ============================================================
-- TABLE 2: debts
-- Each loan the owner has. Entered once, from a form.
-- ============================================================
CREATE TABLE debts (
  id              SERIAL PRIMARY KEY,

  -- Whose loan this is
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Who the loan is from ("SBA", "Kabbage").
  lender          TEXT NOT NULL,

  -- Type of loan: SBA loan, equipment financing, merchant cash advance.
  kind            TEXT,

  -- How much is still owed.
  balance         NUMERIC(12,2) NOT NULL,

  -- The regular monthly payment; the debt wall needs it.
  monthly_payment NUMERIC(10,2) NOT NULL,

  -- Interest rate, like 6.50. Optional.
  rate_pct        NUMERIC(5,2),

  -- Day of the month the payment is due. CHECK blocks impossible days.
  payment_day     INT CHECK (payment_day BETWEEN 1 AND 31),

  -- When the loan ends, so we know when to stop generating payments.
  end_date        DATE,

  -- Big one-time payment at the end, if any (creates the danger zone in the demo).
  balloon_amount  NUMERIC(12,2),
  balloon_date    DATE
);
CREATE INDEX debts_user_idx ON debts (user_id);


-- ============================================================
-- TABLE 3: debt_payments
-- Every upcoming payment, one row each, generated from the debts table.
-- ============================================================
CREATE TABLE debt_payments (
  id       SERIAL PRIMARY KEY,

  -- Which loan this belongs to. ON DELETE CASCADE removes payments
  -- automatically when their loan is deleted.
  debt_id  INT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,

  -- When the payment is due; the debt wall places it on the chart by this.
  due_date DATE NOT NULL,

  -- Usually monthly_payment, or the balloon amount.
  amount   NUMERIC(10,2) NOT NULL
);


-- ============================================================
-- TABLE 4: settings
-- Small key/value store, one set per user. 'opening_cash' is the cash on hand
-- before any logged transactions; the debt wall adds all logged income and
-- expenses to it.
-- ============================================================
CREATE TABLE settings (
  user_id INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
