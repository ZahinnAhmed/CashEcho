-- Not every loan is paid monthly. A merchant cash advance, for example, is often paid back by a
-- fixed debit every business day, and some loans are paid weekly.
--   payment_frequency   'monthly' (on payment_day), 'weekly' (on payment_weekday) or 'daily'
--                       (every business day, Monday to Friday)
--   payment_weekday     0 = Sunday ... 6 = Saturday; only used for weekly loans
-- The existing monthly_payment column now means "the amount of each payment", whatever the
-- frequency, so a daily advance of $38 is stored as monthly_payment = 38.
ALTER TABLE debts
  ADD COLUMN payment_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (payment_frequency IN ('monthly', 'weekly', 'daily')),
  ADD COLUMN payment_weekday INT CHECK (payment_weekday BETWEEN 0 AND 6);
