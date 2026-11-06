# Local attack-chain database

Container: `nt140-attack-chain-db`; volume: `nt140_attack_chain_data`.
Host: `127.0.0.1`; port: `13319`; database: `attack_chain_lab`.
Database login: `attack_lab` / `attack-chain-local-app`.
Local lab root password: `attack-chain-local-root`.

These are public demo credentials, for this local lab only.

Application accounts (intentionally plaintext):

| Name | Email | Password | Role |
|---|---|---|---|
| user | user@attack-chain.test | user123 | user |
| hacker | hacker@attack-chain.test | hacker123 | user |
| admin | admin@attack-chain.test | admin123 | admin |

Four sample products and three categories are included. The schema follows
`schema.sql`. Recreate the data on a new database with `plaintext-lab.sql`;
the script fails if the database already exists and does not overwrite it.

Open the lab website at http://127.0.0.1:3002.
For attack chain 1, the login form uses a text input in
`frontend/views/auth/login.ejs`. The login handler in
`backend/src/controllers/authController.js` accepts nonempty text without
checking email format and compares the demo password as plaintext.
The registration flow still validates email format.

Start the existing container after Docker restarts:
`docker start nt140-attack-chain-db`.
