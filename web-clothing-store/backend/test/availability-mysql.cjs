// Creates and stops its own disposable MySQL. Never targets the application DB.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const name = `nt120-availability-${Date.now()}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
let started = false, paused = false, db, server, setup;
let passed = 0;
async function check(label, work) {
  await work(); passed++;
  console.log(`PASS ${label}`);
}

async function main() {
  docker('run', '-d', '--name', name, '--label', 'nt120.purpose=availability-tests',
    '--tmpfs', '/var/lib/mysql', '-p', '127.0.0.1::3306',
    '-e', 'MYSQL_ROOT_PASSWORD=availability-root-test-only',
    '-e', 'MYSQL_DATABASE=availability_test', '-e', 'MYSQL_USER=availability_test',
    '-e', 'MYSQL_PASSWORD=availability-app-test-only', 'mysql:8.0');
  started = true;
  const port = Number(docker('port', name, '3306/tcp').split(':').at(-1));
  assert.ok(port > 0);
  const config = { host: '127.0.0.1', port, user: 'availability_test',
    password: 'availability-app-test-only', database: 'availability_test', connectTimeout: 1000 };
  for (let attempt = 0; attempt < 60; attempt++) {
    try { setup = await mysql.createConnection({ ...config, multipleStatements: true }); break; }
    catch { await sleep(500); }
  }
  assert.ok(setup, 'Test MySQL did not become ready');
  const schema = await fs.readFile(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
  await setup.query(schema.slice(schema.indexOf('-- =========================')));
  await setup.query("INSERT INTO products(name,price,stock) VALUES('Availability fixture',10,5)");
  await setup.end(); setup = null;
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_HOST: config.host, DB_PORT: String(port), DB_USER: config.user,
    DB_PASSWORD: config.password, DB_NAME: config.database,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), CSRF_TRUSTED_ORIGINS: 'http://localhost:13330'
  });
  db = require('../src/config/db');
  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function http(route) {
    const start = Date.now();
    const response = await fetch(base + route, { signal: AbortSignal.timeout(6000) });
    return { status: response.status, body: await response.json(), ms: Date.now() - start };
  }
  await check('ready returns 200 and catalog works with real MySQL', async () => {
    assert.equal((await http('/ready')).status, 200);
    assert.equal((await http('/api/products')).status, 200);
  });
  await check('test-db real process exits 0 on success, 1 on refused port', async () => {
    for (const [dbPort, expected] of [[String(port), 0], ['1', 1]]) {
      const result = spawnSync(process.execPath, [path.resolve(__dirname, '../test-db.js')], {
        env: { ...process.env, DB_PORT: dbPort }, encoding: 'utf8', timeout: 8000, windowsHide: true
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expected, result.stderr);
    }
  });
  await check('paused DB yields bounded ready/catalog 503 and recovers after unpause', async () => {
    const warm = await Promise.all(Array.from({ length: 10 }, () => db.getConnection()));
    warm.forEach(c => c.release());
    docker('pause', name); paused = true;
    try {
      const results = await Promise.all([http('/ready'), http('/api/products')]);
      for (const result of results) {
        assert.equal(result.status, 503);
        assert.ok(result.ms < 5000, JSON.stringify(result));
      }
      console.log('Paused DB HTTP timings:', JSON.stringify(results.map(({ status, ms }) => ({ status, ms }))));
      assert.equal((await http('/')).status, 200);
    } finally { docker('unpause', name); paused = false; }
    assert.equal((await http('/ready')).status, 200);
    assert.equal((await http('/api/products')).status, 200);
  });
  await check('full pool bounds queue at 50, expires waiters and recovers without executing stale SQL', async () => {
    const held = await Promise.all(Array.from({ length: 10 }, () => db.getConnection()));
    try {
      const pending = Array.from({ length: 51 }, () => db.query("INSERT INTO products(name,price,stock) VALUES('Must not execute',1,1)"));
      const results = await Promise.allSettled(pending);
      assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'DB_QUEUE_FULL').length, 1);
      assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'DB_ACQUIRE_TIMEOUT').length, 50);
      const ready = await http('/ready');
      assert.equal(ready.status, 503);
      assert.ok(ready.ms < 2500);
    } finally { held.forEach(c => c.release()); }
    const [[row]] = await db.query("SELECT COUNT(*) AS n FROM products WHERE name='Must not execute'");
    assert.equal(row.n, 0);
    assert.equal((await http('/ready')).status, 200);
  });
  await check('transaction query timeout closes socket; partial write rolls back after DB resumes', async () => {
    const { withTransaction } = require('../src/utils/transaction');
    try {
      await assert.rejects(withTransaction(async c => {
        await c.query("INSERT INTO products(name,price,stock) VALUES('Must roll back',1,1)");
        docker('pause', name); paused = true;
        await c.query('SELECT 1');
      }), { code: 'DB_QUERY_TIMEOUT' });
    } finally { if (paused) { docker('unpause', name); paused = false; } }
    const [[row]] = await db.query("SELECT COUNT(*) AS n FROM products WHERE name='Must roll back'");
    assert.equal(row.n, 0);
    assert.equal((await http('/ready')).status, 200);
  });
  await check('stopped DB yields 503 without exposing connection internals', async () => {
    docker('stop', name);
    for (const route of ['/ready', '/api/products']) {
      const result = await http(route);
      assert.equal(result.status, 503);
      assert.ok(result.ms < 5000);
      assert.doesNotMatch(JSON.stringify(result.body), /ECONNREFUSED|SELECT|password|127\.0\.0\.1/);
    }
  });
  console.log(`RESULT ${passed}/6 availability checks passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (paused) { docker('unpause', name); paused = false; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) await db.end();
  if (setup) await setup.end();
  if (started) { docker('stop', name); console.log('Stopped disposable container:', name); }
});
