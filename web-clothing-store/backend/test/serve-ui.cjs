// Optional manual/browser smoke environment; never uses backend/.env.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const uiPort = Number(process.env.BASELINE_UI_PORT || 13330);
if (!Number.isInteger(uiPort) || uiPort < 13000 || uiPort > 65000) throw new Error('Test UI port must be between 13000 and 65000');
const uploads = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nt120-baseline-ui-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '13316', DB_NAME: 'nt120_baseline_test',
  DB_USER: 'baseline_test', DB_PASSWORD: 'isolated-app-test-only',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'), CSRF_TRUSTED_ORIGINS: `http://localhost:${uiPort}`,
  FRONTEND_PORT: String(uiPort), API_PROXY_TARGET: `http://127.0.0.1:${uiPort+1}`, API_URL: '/api'
});
process.env.TEST_UPLOAD_DIRECTORY = uploads;
async function main() {
  const db = require('../src/config/db');
  const [[identity]] = await db.query('SELECT DATABASE() AS db');
  if (identity.db !== 'nt120_baseline_test') throw new Error('Refusing non-test database');
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'Ui-baseline-password-2026';
  const hash = await require('bcrypt').hash(password, 4);
  const accounts = {};
  for (const role of ['user', 'admin']) {
    const email = `ui-${role}-${suffix}@baseline.invalid`;
    const [result] = await db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['UI baseline fixture', email, hash, role]);
    accounts[role] = { id: result.insertId, email };
  }
  const products = [];
  for (const stock of [5, 0]) {
    const name = `UI ${stock ? 'available' : 'sold out'} ${suffix}`;
    const [result] = await db.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [name, '12.34', stock]);
    products.push({ id: result.insertId, name });
  }
  const backend = require('../src/app').listen(uiPort+1, '127.0.0.1');
  const frontend = require('../../frontend/server').listen(uiPort, '127.0.0.1');
  console.log(JSON.stringify({ url: `http://localhost:${uiPort}`, password, accounts, products }));
  async function close() {
    await Promise.all([backend, frontend].map(server => new Promise(resolve => server.close(resolve))));
    await db.end();
  }
  process.once('SIGINT', () => { close().catch(console.error); });
  process.once('SIGTERM', () => { close().catch(console.error); });
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
