-- Tiger Data (TimescaleDB) continuous aggregate: one row per user per day, kept up to date
-- automatically. The forecast and the weekly totals read from this instead of scanning
-- every transaction, so they stay fast as the ledger grows.
--
--   income / expenses   everything logged that day
--   net_excl_loans      income minus expenses, leaving out loan_payment entries (the 60-day
--                       average uses this, because future loan payments are subtracted
--                       separately in the forecast)
--
-- Each statement must run on its own (not inside one transaction); db/apply-migration.js does that.

CREATE MATERIALIZED VIEW daily_totals
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  user_id,
  time_bucket('1 day', occurred_at) AS day,
  SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expenses,
  SUM(CASE WHEN category <> 'loan_payment'
           THEN CASE WHEN type = 'income' THEN amount ELSE -amount END
           ELSE 0 END) AS net_excl_loans
FROM transactions
GROUP BY user_id, time_bucket('1 day', occurred_at)
WITH NO DATA;

-- Refresh the finished days every hour (today is covered live because materialized_only = false)
SELECT add_continuous_aggregate_policy('daily_totals',
  start_offset => NULL,
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

CALL refresh_continuous_aggregate('daily_totals', NULL, NULL);
