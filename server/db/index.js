require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to server/.env');
}

// One shared pool; the rest of the server imports this and calls pool.query(...)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Tiger Data requires SSL
});

module.exports = pool;

// Run directly (`node db/index.js`) to test the connection.
if (require.main === module) {
  pool
    .query('SELECT now()')
    .then((res) => console.log('Connected. Database time:', res.rows[0].now))
    .catch((err) => {
      console.error('Connection failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
