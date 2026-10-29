// Real locks and HTTP response loss, using only a freshly created disposable DB.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const mysql = require('mysql2/promise');
const name = `nt120-recovery-${Date.now()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false, setup, db, server, proxy;
async function main() {
  docker('run', '-d', '--name', name, '--label', 'nt120.purpose=checkout-recovery-tests',
    '--tmpfs', '/var/lib/mysql', '-p', '127.0.0.1::3306',
    '-e', 'MYSQL_ROOT_PASSWORD=recovery-root-test-only', '-e', 'MYSQL_DATABASE=recovery_test',
    '-e', 'MYSQL_USER=recovery_test', '-e', 'MYSQL_PASSWORD=recovery-app-test-only', 'mysql:8.0');
  started = true;
  const port = Number(docker('port', name, '3306/tcp').split(':').at(-1));
  for (let i = 0; i < 60; i++) {
    try {
      setup = await mysql.createConnection({ host: '127.0.0.1', port, user: 'recovery_test',
        password: 'recovery-app-test-only', database: 'recovery_test', multipleStatements: true, connectTimeout: 1000 });
      break;
    } catch { await sleep(500); }
  }
  assert.ok(setup, 'Disposable DB not ready');
  const schema = await fs.readFile(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
  const oldSchema=schema.slice(schema.indexOf('-- ========================='))
    .replace('    checkout_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,','')
    .replace('    CONSTRAINT uq_orders_checkout UNIQUE (user_id, checkout_key),','');
  await setup.query(oldSchema);
  await setup.query("INSERT INTO users(name,email,password) VALUES('Historical fixture','historical@fixture.invalid','unused')");
  await setup.query("INSERT INTO orders(user_id,total,status) VALUES(1,12.34,'pending')");
  const [historical]=await setup.query('SELECT id,user_id,total,status,created_at FROM orders');
  const {migrate}=require('../scripts/migrate-checkout.cjs');
  await migrate(setup);await migrate(setup);
  assert.deepEqual((await setup.query('SELECT id,user_id,total,status,created_at FROM orders'))[0],historical);
  assert.equal((await setup.query('SELECT checkout_key FROM orders WHERE id=1'))[0][0].checkout_key,null);
  console.log('PASS additive migration preserves historical orders and is repeatable');
  await setup.end(); setup = null;
  Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(port),
    DB_USER: 'recovery_test', DB_PASSWORD: 'recovery-app-test-only', DB_NAME: 'recovery_test',
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), CSRF_TRUSTED_ORIGINS: 'http://localhost:13330' });
  db = require('../src/config/db');
  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csrf = (await (await fetch(base + '/api/auth/csrf')).json()).csrfToken;
  async function fixture() {
    const [u] = await db.query("INSERT INTO users(name,email,password) VALUES('Recovery fixture',?,'unused')", [crypto.randomUUID() + '@fixture.invalid']);
    const [p] = await db.query("INSERT INTO products(name,price,stock) VALUES('Recovery fixture',10,5)");
    const cookie = 'token=' + require('jsonwebtoken').sign({ id: u.insertId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    return { user: u.insertId, product: p.insertId, cookie, checkoutKey: crypto.randomUUID() };
  }
  function headers(f) { return { Origin: 'http://localhost:13330', Cookie: f.cookie,
    'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': f.checkoutKey }; }
  async function request(f, route, body = {}, target = base) {
    const response = await fetch(target + '/api' + route, { method: 'POST', headers: headers(f),
      body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    return { status: response.status, body: await response.json() };
  }
  async function state(f) {
    const [[row]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM orders WHERE user_id=?) AS orders,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=?) AS items,
      (SELECT COALESCE(SUM(quantity),0) FROM cart_items WHERE user_id=?) AS cart,
      (SELECT stock FROM products WHERE id=?) AS stock`, [f.user, f.user, f.user, f.product]);
    return { orders: Number(row.orders), items: Number(row.items), cart: Number(row.cart), stock: row.stock };
  }

  // Set a short MySQL lock-wait deadline on test connections, not a mocked error.
  const originalAcquire = db.getConnection;
  db.getConnection = async () => {
    const c = await originalAcquire();
    await c.query('SET SESSION innodb_lock_wait_timeout = 1');
    return c;
  };
  {
    const f = await fixture();
    assert.equal((await request(f, '/cart', { product_id: f.product })).status, 201);
    const lock = await db.getConnection();
    try {
      await lock.beginTransaction();
      await lock.query('SELECT id FROM products WHERE id=? FOR UPDATE', [f.product]);
      const startedAt = Date.now();
      const result = await request(f, '/orders');
      assert.equal(result.status, 409, JSON.stringify(result));
      assert.match(result.body.message, /retry/i);
      const ms = Date.now() - startedAt;
      assert.ok(ms < 2800);
      assert.deepEqual(await state(f), { orders: 0, items: 0, cart: 1, stock: 5 });
      console.log('PASS real server lock-wait timeout -> HTTP 409, rollback intact; ms=' + ms);
    } finally { await lock.rollback(); lock.release(); }
    assert.equal((await request(f, '/orders')).status, 201);
    assert.deepEqual(await state(f), { orders: 1, items: 1, cart: 0, stock: 4 });
    console.log('PASS normal checkout succeeds after lock-wait failure');
  }
  db.getConnection = originalAcquire;

  {
    const f = await fixture();
    assert.equal((await request(f, '/cart', { product_id: f.product })).status, 201);
    const blocker = await db.getConnection();
    let restoreObserver;
    try {
      await blocker.beginTransaction();
      // Make blocker the heavier transaction so InnoDB selects the lightweight
      // checkout as victim. These are real, uncommitted fixture writes.
      for (let i = 0; i < 30; i++) await blocker.query("INSERT INTO products(name,price,stock) VALUES('Deadlock weight fixture',1,1)");
      await blocker.query('SELECT id FROM products WHERE id=? FOR UPDATE', [f.product]);
      let reached;
      const waiting = new Promise(resolve => { reached = resolve; });
      db.getConnection = async () => {
        const c = await originalAcquire();
        const query = c.query.bind(c);
        c.query = (sql, ...args) => {
          const pending = query(sql, ...args);
          if (sql.includes('SELECT id, price, stock FROM products')) {
            db.getConnection = originalAcquire;
            reached();
          }
          return pending;
        };
        return c;
      };
      restoreObserver = () => { db.getConnection = originalAcquire; };
      const checkout = request(f, '/orders');
      // Attach rejection handling immediately while orchestrating the other connection.
      const outcome = checkout.then(value => ({ value }), error => ({ error }));
      let timer;
      try {
        await Promise.race([waiting, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Checkout did not reach the product lock')), 2000);
        })]);
      } finally { clearTimeout(timer); }
      // Checkout owns users/cart and waits for product. Blocker owns product and
      // now requests that user's lock, forming a real InnoDB deadlock.
      await blocker.query('SELECT id FROM users WHERE id=? FOR UPDATE', [f.user]);
      const result = await outcome;
      if (result.error) throw result.error;
      assert.equal(result.value.status, 409, JSON.stringify(result.value));
      assert.match(result.value.body.message, /retry/i);
      assert.deepEqual(await state(f), { orders: 0, items: 0, cart: 1, stock: 5 });
      console.log('PASS real InnoDB deadlock -> checkout victim HTTP 409, no partial order');
    } finally {
      if (restoreObserver) restoreObserver();
      await blocker.rollback(); blocker.release();
    }
    assert.equal((await request(f, '/orders')).status, 201);
    console.log('PASS normal checkout succeeds after deadlock rollback');
  }

  {
    const f = await fixture();
    assert.equal((await request(f, '/cart', { product_id: f.product })).status, 201);
    let upstreamStatus;
    proxy = http.createServer((incoming, outgoing) => {
      const upstream = http.request(base + incoming.url, { method: incoming.method, headers: incoming.headers }, response => {
        upstreamStatus = response.statusCode;
        // Backend has committed and produced a response, but the browser never
        // receives that response. Do not tamper with SQL or COMMIT itself.
        response.resume(); outgoing.destroy();
      });
      upstream.on('error', () => outgoing.destroy());
      incoming.pipe(upstream);
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => proxy.once('listening', resolve));
    await assert.rejects(request(f, '/orders', {}, `http://127.0.0.1:${proxy.address().port}`));
    assert.equal(upstreamStatus, 201);
    assert.deepEqual(await state(f), { orders: 1, items: 1, cart: 0, stock: 4 });
    console.log('PASS response dropped after committed checkout: exactly one durable order');
    const retry = await request(f, '/orders');
    assert.equal(retry.status, 201);
    assert.deepEqual(await state(f), { orders: 1, items: 1, cart: 0, stock: 4 });
    assert.equal(retry.body.orderId > 0, true);
    console.log('PASS retry with empty cart returns original order (HTTP 201)');
    assert.equal((await request(f, '/cart', { product_id: f.product })).status, 201);
    const oldRetry = await request(f, '/orders');
    assert.equal(oldRetry.status, 201);
    assert.equal(oldRetry.body.orderId, retry.body.orderId);
    assert.deepEqual(oldRetry.body, retry.body);
    assert.deepEqual(await state(f), { orders: 1, items: 1, cart: 1, stock: 4 });
    console.log('PASS replay after refill returns original order and preserves the new cart');
    f.checkoutKey=crypto.randomUUID();
    assert.equal((await request(f, '/orders')).status, 201);
    assert.deepEqual(await state(f), { orders: 2, items: 2, cart: 0, stock: 3 });
    console.log('PASS new checkout intent uses a new key and creates the next order');
    console.log('RESULT all lock and response-loss recovery scenarios passed');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) await db.end();
  if (setup) await setup.end();
  if (started) { docker('stop', name); console.log('Stopped disposable container:', name); }
});
