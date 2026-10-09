// Runs a migration file one statement at a time (continuous aggregates cannot be created
// inside a transaction, and sending a whole file at once wraps it in one).
//   node db/apply-migration.js db/migrations/003-daily-totals.sql
const fs = require('fs');
const pool = require('./index');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node db/apply-migration.js <file.sql>');
    process.exit(1);
  }
  const statements = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await pool.query(sql);
    console.log('ok:', sql.split('\n')[0].slice(0, 70));
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
