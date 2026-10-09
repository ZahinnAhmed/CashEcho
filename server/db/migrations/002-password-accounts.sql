-- Lets people sign up with an email and password as well as with Google.
-- password_hash is NULL for accounts that only use Google. It stores a salted
-- scrypt hash ("salt:hash"), never the password itself.
ALTER TABLE users ADD COLUMN password_hash TEXT;
