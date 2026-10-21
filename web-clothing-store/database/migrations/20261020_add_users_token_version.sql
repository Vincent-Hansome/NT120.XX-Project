-- One-time migration for an existing database. Run only if users.token_version does not exist.
ALTER TABLE users
    ADD COLUMN token_version INT NOT NULL DEFAULT 0;
