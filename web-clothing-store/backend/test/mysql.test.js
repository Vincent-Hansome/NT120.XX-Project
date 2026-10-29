const assert = require('node:assert/strict');
const { before, after, describe, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

describe('isolated MySQL business regressions', { skip: process.env.RUN_MYSQL_TESTS !== '1' }, () => {
  // Deliberately fixed target: never inherit the application's .env credentials.
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '13316',
    DB_NAME: 'nt120_baseline_test', DB_USER: 'baseline_test', DB_PASSWORD: 'isolated-app-test-only',
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), CSRF_TRUSTED_ORIGINS: 'http://localhost:13330'
  });
  let db, server, base, csrf, passwordHash;
  const jwt = require('jsonwebtoken');
  const uploads = path.join(require('node:os').tmpdir(), `nt120-baseline-uploads-${crypto.randomUUID()}`);
  process.env.TEST_UPLOAD_DIRECTORY = uploads;
  const uploadedFiles = [];

  before(async () => {
    await fs.mkdir(uploads);
    const mysql = require('mysql2/promise');
    const setup = await mysql.createConnection({
      host: '127.0.0.1', port: 13316, user: 'baseline_test', password: 'isolated-app-test-only',
      database: 'nt120_baseline_test', multipleStatements: true
    });
    try {
      const [[identity]] = await setup.query('SELECT DATABASE() AS db, @@version AS version');
      assert.equal(identity.db, 'nt120_baseline_test');
      assert.match(identity.version, /^8\./);
      const schema = await fs.readFile(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
      // Only CREATE TABLE statements, in the isolated database; no seed/reset/drop.
      await setup.query(schema.slice(schema.indexOf('-- =========================')));
      // Supports existing disposable test volumes as well as new schemas.
      await require('../scripts/migrate-checkout.cjs').migrate(setup);
      await require('../scripts/migrate-checkout.cjs').migrate(setup);
      const [[mode]] = await setup.query('SELECT @@sql_mode AS mode');
      assert.match(mode.mode, /STRICT_TRANS_TABLES/);
    } finally { await setup.end(); }
    passwordHash = await require('bcrypt').hash('Baseline-test-password-2026', 4);
    db = require('../src/config/db');
    server = require('../src/app').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    csrf = (await (await fetch(`${base}/api/auth/csrf`)).json()).csrfToken;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
    await Promise.all(uploadedFiles.map(file => fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    await fs.rmdir(uploads);
  });

  async function request(route, user, method = 'GET', body, extraHeaders = {}) {
    const token = user ? jwt.sign({ id: user.id, tokenVersion: user.version || 0 }, process.env.JWT_SECRET, { expiresIn: '5m' }) : null;
    const multipart = body instanceof FormData;
    const response = await fetch(`${base}/api${route}`, {
      method, headers: {
        Origin: 'http://localhost:13330', 'X-CSRF-Token': csrf,
        ...(route === '/orders' && method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        ...(token ? { Cookie: `token=${token}` } : {}),
        ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function user(role = 'user') {
    const [result] = await db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Baseline fixture', `${crypto.randomUUID()}@baseline.invalid`, passwordHash, role]);
    return { id: result.insertId };
  }
  function payload(overrides = {}) {
    return { name: 'Baseline product', price: '12.34', stock: 10, description: '', size: '', color: '', category_id: '', ...overrides };
  }
  async function product(overrides = {}) {
    const p = payload(overrides);
    const [result] = await db.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [p.name, p.price, p.stock]);
    return result.insertId;
  }
  async function add(u, p, quantity = 1) {
    const result = await request('/cart', u, 'POST', { product_id: p, quantity });
    assert.equal(result.status, 201, JSON.stringify(result));
  }
  async function cart(u) { return (await request('/cart', u)).data; }
  async function stock(p) { return (await request(`/products/${p}`)).data.stock; }
  async function counts(u) {
    const [[result]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS orders,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ?) AS items`, [u.id, u.id]);
    return result;
  }
  async function form(overrides = {}, image = false) {
    const body = new FormData();
    for (const [key, value] of Object.entries(payload(overrides))) body.set(key, String(value));
    if (image) {
      const png = await require('sharp')({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
      body.set('image', new Blob([png], { type: 'image/png' }), 'fixture.png');
    }
    return body;
  }

  // A scheduling gate around real queries, not a fake database. The transaction
  // is paused with its actual InnoDB locks held; a competing HTTP request runs.
  function interceptQuery(fragment, pause) {
    const original = db.getConnection;
    let entered, resume;
    const reached = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    db.getConnection = async function () {
      const connection = await original.call(db);
      db.getConnection = original;
      const query = connection.query.bind(connection);
      let paused = false;
      connection.query = async (...args) => {
        const pending = query(...args);
        if (!pause && !paused && args[0].includes(fragment)) { paused = true; entered(); }
        const result = await pending;
        if (!paused && args[0].includes(fragment)) {
          paused = true;
          entered();
          if (pause) await gate;
        }
        return result;
      };
      const release = connection.release.bind(connection);
      connection.release = () => { connection.query = query; connection.release = release; release(); };
      return connection;
    };
    return { reached, resume, restore() { db.getConnection = original; resume(); } };
  }
  const pauseAfter = fragment => interceptQuery(fragment, true);
  const observeBefore = fragment => interceptQuery(fragment, false);

  test('checkout validates keys, replays the same result and preserves refilled cart', async () => {
    const u=await user(), p=await product();
    await add(u,p);
    const key=crypto.randomUUID();
    for (const [value,status] of [['',428],['invalid',400],['x'.repeat(200),400]]) {
      assert.equal((await request('/orders',u,'POST',{}, {'Idempotency-Key':value})).status,status);
    }
    assert.deepEqual(await counts(u),{orders:0,items:0});
    const first=await request('/orders',u,'POST',{}, {'Idempotency-Key':key});
    assert.equal(first.status,201);
    await add(u,p);
    const replay=await request('/orders',u,'POST',{}, {'Idempotency-Key':key.toUpperCase()});
    assert.equal(replay.status,201);
    assert.deepEqual(replay.data,first.data);
    assert.deepEqual(await counts(u),{orders:1,items:1});
    assert.equal((await cart(u))[0].quantity,1);
    assert.equal(await stock(p),9);
  });

  test('two concurrent requests with one key return one durable order', async () => {
    const u=await user(), p=await product(), key=crypto.randomUUID();
    await add(u,p);
    const results=await Promise.all([1,2].map(()=>request('/orders',u,'POST',{}, {'Idempotency-Key':key})));
    assert.deepEqual(results.map(r=>r.status),[201,201]);
    assert.deepEqual(results[0].data,results[1].data);
    assert.deepEqual(await counts(u),{orders:1,items:1});
    assert.equal(await stock(p),9);
  });

  test('checkout keys are scoped to each user and a new key creates a new intent', async () => {
    const a=await user(), b=await user(), p=await product(), key=crypto.randomUUID();
    await add(a,p); await add(b,p);
    const x=await request('/orders',a,'POST',{}, {'Idempotency-Key':key});
    const y=await request('/orders',b,'POST',{}, {'Idempotency-Key':key});
    assert.equal(x.status,201);assert.equal(y.status,201);
    assert.notEqual(x.data.orderId,y.data.orderId);
    await add(a,p);
    const z=await request('/orders',a,'POST',{}, {'Idempotency-Key':crypto.randomUUID()});
    assert.equal(z.status,201);assert.notEqual(z.data.orderId,x.data.orderId);
    assert.deepEqual(await counts(a),{orders:2,items:2});
  });

  test('failed checkout does not consume its key; retry after correction succeeds', async () => {
    const u=await user(), p=await product({price:'50000000.00',stock:2}), key=crypto.randomUUID();
    await add(u,p,2);
    assert.equal((await request('/orders',u,'POST',{}, {'Idempotency-Key':key})).status,422);
    assert.deepEqual(await counts(u),{orders:0,items:0});
    const item=(await cart(u))[0];
    assert.equal((await request(`/cart/${item.id}`,u,'PUT',{quantity:1})).status,200);
    assert.equal((await request('/orders',u,'POST',{}, {'Idempotency-Key':key})).status,201);
    assert.deepEqual(await counts(u),{orders:1,items:1});
  });

  test('two concurrent adds preserve both increments, also on an initially empty cart', async () => {
    for (const initial of [0, 1]) {
      const u = await user(), p = await product();
      if (initial) await add(u, p);
      const results = await Promise.all([request('/cart', u, 'POST', { product_id: p }), request('/cart', u, 'POST', { product_id: p })]);
      assert.deepEqual(results.map(r => r.status), [201, 201]);
      assert.equal((await cart(u))[0].quantity, initial + 2);
      assert.equal((await cart(u)).length, 1);
    }
  });
  test('cart quantity boundaries, missing products/items, and stock conflicts leave the cart intact', async () => {
    const u = await user(), p = await product({ stock: 1 });
    const results = await Promise.all([request('/cart', u, 'POST', { product_id: p }), request('/cart', u, 'POST', { product_id: p })]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const item = (await cart(u))[0];
    assert.equal((await request(`/cart/${item.id}`, u, 'PUT', { quantity: 2 })).status, 409);
    assert.equal((await request(`/cart/${item.id}`, u, 'PUT', { quantity: 1 })).status, 200);
    for (const quantity of [0, -1, 1.5, 2147483648, '99999999999999999999999999']) {
      assert.equal((await request('/cart', u, 'POST', { product_id: p, quantity })).status, 400);
    }
    assert.equal((await request('/cart', u, 'POST', { product_id: 2147483647 })).status, 404);
    assert.equal((await request('/cart/2147483647', u, 'PUT', { quantity: 1 })).status, 404);
    assert.equal((await cart(u))[0].quantity, 1);
    const max = await product({ stock: 2147483647 });
    await add(u, max, 2147483647);
    assert.equal((await request('/cart', u, 'POST', { product_id: max })).status, 409);
    assert.equal((await cart(u)).find(i => i.product_id === max).quantity, 2147483647);
  });
  test('absolute update and incremental add serialize consistently', async () => {
    const u = await user(), p = await product();
    await add(u, p);
    const item = (await cart(u))[0];
    const pause = pauseAfter('SELECT id FROM users');
    const updating = request(`/cart/${item.id}`, u, 'PUT', { quantity: 5 });
    try {
      await pause.reached;
      const observed = observeBefore('SELECT id FROM users');
      const adding = request('/cart', u, 'POST', { product_id: p, quantity: 2 });
      await observed.reached;
      pause.resume();
      assert.deepEqual((await Promise.all([updating, adding])).map(r => r.status), [200, 201]);
      assert.equal((await cart(u))[0].quantity, 7);
    } finally { pause.restore(); }
  });
  test('two customers checking out the last item yield one order and preserve the losing cart', async () => {
    const a = await user(), b = await user(), p = await product({ stock: 1 });
    await add(a, p); await add(b, p);
    const results = await Promise.all([request('/orders', a, 'POST', {}), request('/orders', b, 'POST', {})]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const winner = results[0].status === 201 ? a : b, loser = winner === a ? b : a;
    assert.equal(await stock(p), 0);
    assert.deepEqual(await counts(winner), { orders: 1, items: 1 });
    assert.deepEqual(await counts(loser), { orders: 0, items: 0 });
    assert.equal((await cart(winner)).length, 0);
    assert.equal((await cart(loser))[0].quantity, 1);
  });
  test('two checkouts for one cart cannot create duplicate orders', async () => {
    const u = await user(), p = await product(); await add(u, p);
    const results = await Promise.all([request('/orders', u, 'POST', {}), request('/orders', u, 'POST', {})]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
    assert.deepEqual(await counts(u), { orders: 1, items: 1 });
    assert.equal(await stock(p), 9);
  });
  test('add after checkout starts is retained as a new cart, never silently deleted', async () => {
    const u = await user(), p = await product(); await add(u, p);
    const pause = pauseAfter('SELECT id FROM users');
    const checkout = request('/orders', u, 'POST', {});
    try {
      await pause.reached;
      const observed = observeBefore('SELECT id FROM users');
      const adding = request('/cart', u, 'POST', { product_id: p, quantity: 2 });
      await observed.reached;
      pause.resume();
      assert.deepEqual((await Promise.all([checkout, adding])).map(r => r.status), [201, 201]);
      assert.equal((await cart(u))[0].quantity, 2);
      assert.equal(await stock(p), 9);
      assert.deepEqual(await counts(u), { orders: 1, items: 1 });
    } finally { pause.restore(); }
  });
  test('update before checkout is included; update/delete after checkout return 404', async () => {
    const u = await user(), p = await product(); await add(u, p);
    const item = (await cart(u))[0];
    const pause = pauseAfter('SELECT id FROM users');
    const updating = request(`/cart/${item.id}`, u, 'PUT', { quantity: 3 });
    try {
      await pause.reached;
      const observed = observeBefore('SELECT id FROM users');
      const checkout = request('/orders', u, 'POST', {});
      await observed.reached;
      pause.resume();
      assert.deepEqual((await Promise.all([updating, checkout])).map(r => r.status), [200, 201]);
      assert.equal(await stock(p), 7);
      assert.equal((await cart(u)).length, 0);
      assert.equal((await request(`/cart/${item.id}`, u, 'PUT', { quantity: 4 })).status, 404);
      assert.equal((await request(`/cart/${item.id}`, u, 'DELETE')).status, 404);
    } finally { pause.restore(); }
  });
  test('update and delete submitted while checkout holds the cart lock return 404 after checkout', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const u = await user(), p = await product(); await add(u, p);
      const item = (await cart(u))[0];
      const pause = pauseAfter('SELECT id FROM users');
      const checkout = request('/orders', u, 'POST', {});
      try {
        await pause.reached;
        const observed = observeBefore('SELECT id FROM users');
        const mutation = request(`/cart/${item.id}`, u, method, method === 'PUT' ? { quantity: 3 } : undefined);
        await observed.reached;
        pause.resume();
        assert.deepEqual((await Promise.all([checkout, mutation])).map(r => r.status), [201, 404]);
        assert.equal(await stock(p), 9);
        assert.equal((await cart(u)).length, 0);
        assert.deepEqual(await counts(u), { orders: 1, items: 1 });
      } finally { pause.restore(); }
    }
  });
  test('money is exact, zero and DECIMAL maximum succeed; overflow is 422 with full rollback', async () => {
    for (const [price, quantity, total, status] of [
      ['0.10', 3, '0.30', 201], ['0', 1, '0.00', 201],
      ['99999999.99', 1, '99999999.99', 201], ['99999999.99', 2, null, 422],
      ['50000000.00', 2, null, 422]
    ]) {
      const u = await user(), p = await product({ price, stock: 3 }); await add(u, p, quantity);
      const order = await request('/orders', u, 'POST', {});
      assert.equal(order.status, status, JSON.stringify(order));
      if (status === 201) {
        assert.equal(order.data.total, total);
        const detail = await request(`/orders/${order.data.orderId}`, u);
        assert.equal(detail.data.order.total, total);
        assert.equal(await stock(p), 3 - quantity);
      } else {
        assert.equal(await stock(p), 3);
        assert.equal((await cart(u))[0].quantity, quantity);
        assert.deepEqual(await counts(u), { orders: 0, items: 0 });
      }
    }
    assert.equal((await request('/orders', await user(), 'POST', {})).status, 400);
    const u = await user(), a = await product({ price: '0.10' }), b = await product({ price: '0.20' });
    await add(u, a); await add(u, b);
    assert.equal((await request('/orders', u, 'POST', {})).data.total, '0.30');
  });
  test('real MySQL failure after an order, item and stock write rolls back every change', async () => {
    const u = await user(), a = await product(), b = await product();
    await add(u, a, 2); await add(u, b, 3);
    const trigger = `baseline_fail_${crypto.randomBytes(6).toString('hex')}`;
    await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON order_items FOR EACH ROW
      BEGIN IF NEW.product_id = ${b} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test-only failure'; END IF; END`);
    // The trigger only rejects the newly created fixture product, in this test DB.
    const failed = await request('/orders', u, 'POST', {});
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.data, { message: 'Server error' });
    assert.equal(await stock(a), 10); assert.equal(await stock(b), 10);
    assert.deepEqual((await cart(u)).map(i => i.quantity), [2, 3]);
    assert.deepEqual(await counts(u), { orders: 0, items: 0 });
    // A subsequent checkout on another fixture confirms connections remain usable.
    const other = await user(); await add(other, a);
    assert.equal((await request('/orders', other, 'POST', {})).status, 201);
  });
  test('stale admin form racing checkout returns 409; fresh and unchanged updates succeed', async () => {
    const admin = await user('admin'), u = await user(), p = await product(); await add(u, p);
    const old = (await request(`/products/${p}`)).data;
    const pause = pauseAfter('SELECT id, price, stock FROM products');
    const checkout = request('/orders', u, 'POST', {});
    try {
      await pause.reached;
      const observed = observeBefore('SELECT * FROM products');
      const editing = request(`/products/${p}`, admin, 'PUT', payload({ name: 'Stale name', stock: old.stock, revision: old.revision }));
      await observed.reached;
      pause.resume();
      assert.deepEqual((await Promise.all([checkout, editing])).map(r => r.status), [201, 409]);
    } finally { pause.restore(); }
    assert.equal(await stock(p), 9);
    const current = (await request(`/products/${p}`)).data;
    assert.equal(current.name, 'Baseline product');
    assert.equal((await request(`/products/${p}`, admin, 'PUT', payload({ stock: 9 }))).status, 428);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', payload({ stock: 9, revision: 'bad' }))).status, 400);
    const body = payload({ stock: 9, revision: current.revision });
    assert.equal((await request(`/products/${p}`, admin, 'PUT', body)).status, 200);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', body)).status, 200);
    assert.equal(await stock(p), 9);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', payload({ name: 'Fresh name', stock: 8, revision: current.revision }))).status, 200);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', body)).status, 409);
  });
  test('CRUD missing rows are 404, no-op category updates succeed, duplicate categories are 409', async () => {
    const admin = await user('admin');
    for (const route of ['/products/2147483647', '/categories/2147483647']) {
      assert.equal((await request(route, admin, 'DELETE')).status, 404);
      assert.equal((await request(route, admin, 'PUT', route.includes('products') ? payload() : { name: 'Missing' })).status, 404);
    }
    const name = `Category ${crypto.randomUUID()}`;
    const created = await request('/categories', admin, 'POST', { name });
    assert.equal(created.status, 201);
    assert.equal((await request(`/categories/${created.data.id}`, admin, 'PUT', { name })).status, 200);
    assert.equal((await request('/categories', admin, 'POST', { name })).status, 409);
    const p = await product();
    const current = (await request(`/products/${p}`)).data;
    assert.equal((await request(`/products/${p}`, admin, 'PUT', payload({ category_id: created.data.id, revision: current.revision }))).status, 200);
    assert.equal((await request(`/categories/${created.data.id}`, admin, 'DELETE')).status, 200);
    assert.equal((await request(`/products/${p}`)).data.category_id, null);
    assert.equal((await request(`/products/${p}`, admin, 'DELETE')).status, 200);
    assert.equal((await request(`/products/${p}`)).status, 404);
  });
  test('deleting a purchased product returns 409 and preserves orders, items, product and cart', async () => {
    const admin = await user('admin'), u = await user(), other = await user(), p = await product();
    await add(u, p); await add(other, p);
    const order = await request('/orders', u, 'POST', {});
    assert.equal((await request(`/products/${p}`, admin, 'DELETE')).status, 409);
    assert.deepEqual(await counts(u), { orders: 1, items: 1 });
    assert.equal((await request(`/orders/${order.data.orderId}`, u)).data.items[0].product_id, p);
    assert.equal(await stock(p), 9);
    assert.equal((await cart(other))[0].quantity, 1);
  });
  test('normalized uploads are cleaned on 404, stale 409, validation and database failures', async () => {
    const admin = await user('admin'), p = await product();
    const baseline = (await fs.readdir(uploads)).sort();
    assert.equal((await request('/products/2147483647', admin, 'PUT', await form({}, true))).status, 404);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', await form({ revision: '0'.repeat(64) }, true))).status, 409);
    assert.equal((await request('/products', admin, 'POST', await form({ name: '' }, true))).status, 400);
    const badName = `Rejected ${crypto.randomUUID()}`;
    const trigger = `baseline_product_fail_${crypto.randomBytes(6).toString('hex')}`;
    // The random fixture name is generated locally, not user SQL input.
    await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON products FOR EACH ROW
      BEGIN IF NEW.name = '${badName}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test-only failure'; END IF; END`);
    assert.equal((await request('/products', admin, 'POST', await form({ name: badName }, true))).status, 500);
    const current = (await request(`/products/${p}`)).data;
    const updateTrigger = `baseline_update_fail_${crypto.randomBytes(6).toString('hex')}`;
    await db.query(`CREATE TRIGGER ${updateTrigger} BEFORE UPDATE ON products FOR EACH ROW
      BEGIN IF NEW.id = ${p} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test-only update failure'; END IF; END`);
    assert.equal((await request(`/products/${p}`, admin, 'PUT', await form({ revision: current.revision }, true))).status, 500);
    assert.deepEqual((await fs.readdir(uploads)).sort(), baseline);
    const created = await request('/products', admin, 'POST', await form({}, true));
    assert.equal(created.status, 201);
    const saved = (await request(`/products/${created.data.id}`)).data;
    uploadedFiles.push(path.join(uploads, path.basename(saved.image_url)));
    assert.equal((await fs.stat(uploadedFiles.at(-1))).isFile(), true);
  });
  test('password change clears cookie, revokes both prior sessions and allows new login', async () => {
    const u = await user();
    const changed = await request('/users/me', u, 'PUT', { currentPassword: 'Baseline-test-password-2026', newPassword: 'Changed-baseline-password-2026' });
    assert.equal(changed.status, 200); assert.equal(changed.data.reauthenticate, true);
    assert.match(changed.headers.get('set-cookie'), /token=;.*Expires=Thu, 01 Jan 1970/i);
    assert.equal((await request('/users/me', u)).status, 401);
    assert.equal((await request('/users/me', { ...u })).status, 401);
    const [[row]] = await db.query('SELECT email FROM users WHERE id = ?', [u.id]);
    assert.equal((await request('/auth/login', null, 'POST', { email: row.email, password: 'Baseline-test-password-2026' })).status, 401);
    const login = await request('/auth/login', null, 'POST', { email: row.email, password: 'Changed-baseline-password-2026' });
    assert.equal(login.status, 200);
    assert.equal((await request('/users/me', { id: u.id, version: 1 })).status, 200);
  });
});
