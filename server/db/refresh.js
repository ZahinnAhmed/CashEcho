const pool = require('./index');

// The daily_totals aggregate refreshes itself every hour, and "today" is always read live.
// A transaction dated on an earlier day (a back-dated entry, or an undo) would otherwise
// show up a little late, so we refresh just that one day right away.
async function refreshDay(date) {
  try {
    await pool.query(
      `CALL refresh_continuous_aggregate(
         'daily_totals',
         ($1::date::timestamp AT TIME ZONE 'UTC'),
         (($1::date + 1)::timestamp AT TIME ZONE 'UTC'))`,
      [date]
    );
  } catch (err) {
    console.error('[daily_totals] refresh failed:', err.message);
  }
}

module.exports = { refreshDay };
