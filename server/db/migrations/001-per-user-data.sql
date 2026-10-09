-- Gives every user their own data.
-- Run this on a database that already has the original four tables.
-- (A brand-new database can just run schema.sql, which already includes this.)
-- It requires transactions, debts and settings to be empty, because each row needs an owner.

-- One row per Google account that has signed in
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  picture       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every transaction and loan now belongs to a user; deleting a user deletes their data
ALTER TABLE transactions ADD COLUMN user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE debts        ADD COLUMN user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX transactions_user_idx ON transactions (user_id, occurred_at DESC);
CREATE INDEX debts_user_idx        ON debts (user_id);

-- Settings (such as opening_cash) are now per user
DROP TABLE settings;
CREATE TABLE settings (
  user_id INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
