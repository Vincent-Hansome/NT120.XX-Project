// Real HTTP + MySQL checks on a unique disposable container; no application .env.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const container = `nt120-support-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
let created = false, connection, db, backend, frontend, browser;
let checks = 0;
const origin = 'http://localhost:13330';
const password = 'Support-fixture-password-2026';

async function check(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

async function main() {
  docker('run', '-d', '--name', container, '--label', 'nt120.purpose=support-tests', '--tmpfs', '/var/lib/mysql',
    '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD=support-root-test-only',
    '-e', 'MYSQL_DATABASE=support_test', '-e', 'MYSQL_USER=support_test',
    '-e', 'MYSQL_PASSWORD=support-app-test-only', 'mysql:8.0');
  created = true;
  const port = Number(docker('port', container, '3306/tcp').split(':').at(-1));
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'support_test',
        password: 'support-app-test-only', database: 'support_test', multipleStatements: true, connectTimeout: 1000 });
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(connection, 'Disposable support database did not start');
  assert.equal((await connection.query('SELECT DATABASE() AS db'))[0][0].db, 'support_test');
  const schema = await fs.readFile(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
  const legacySchema = schema.slice(schema.indexOf('-- ========================='))
    .replace(/CREATE TABLE IF NOT EXISTS support_tickets \([\s\S]+?COLLATE=utf8mb4_unicode_ci;/, '');
  assert.ok(!legacySchema.includes('CREATE TABLE IF NOT EXISTS support_tickets'));
  await connection.query(legacySchema);
  const hash = await require('bcrypt').hash(password, 4);
  const accounts = {};
  for (const [key, role] of [['a', 'user'], ['b', 'user'], ['admin', 'admin']]) {
    const email = `${key}@support-fixture.invalid`;
    const [result] = await connection.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [`Khách thử ${key}`, email, hash, role]);
    accounts[key] = { id: result.insertId, email, role };
  }
  const previousUsers = (await connection.query('SELECT * FROM users ORDER BY id'))[0];
  const { migrate } = require('../scripts/migrate-support.cjs');
  await check('migration creates the missing table, repeats safely and preserves existing users', async () => {
    await migrate(connection);
    await migrate(connection);
    assert.deepEqual((await connection.query('SELECT * FROM users ORDER BY id'))[0], previousUsers);
    assert.equal((await connection.query('SELECT COUNT(*) AS n FROM support_tickets'))[0][0].n, 0);
  });
  Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(port),
    DB_NAME: 'support_test', DB_USER: 'support_test', DB_PASSWORD: 'support-app-test-only',
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), CSRF_TRUSTED_ORIGINS: origin });
  db = require('../src/config/db');
  backend = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(resolve => backend.once('listening', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  const csrf = (await (await fetch(`${base}/api/auth/csrf`)).json()).csrfToken;
  const cookie = account => account ? `token=${jwt.sign({ id: account.id, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' })}` : '';
  async function request(route, account, method = 'GET', body, extraHeaders = {}) {
    const headers = { Origin: origin, 'X-CSRF-Token': csrf, Cookie: cookie(account), ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}/api/support${route}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const message = '<img src=x onerror="window.__supportXss=true">\nNội dung tiếng Việt 👋';
  let ticket;
  await check('anonymous access and missing CSRF are rejected', async () => {
    assert.equal((await request('/tickets')).status, 401);
    assert.equal((await request('/tickets', null, 'POST', { subject: 'Hi', message: 'Hi' })).status, 401);
    assert.equal((await request('/tickets', accounts.a, 'POST', { subject: 'Hi', message: 'Hi' }, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await request('/tickets', accounts.a, 'POST', { subject: 'Hi', message: 'Hi' }, { Origin: 'https://outside.invalid' })).status, 403);
  });
  await check('customer creates a persisted ticket with server-controlled identity and status', async () => {
    const result = await request('/tickets', accounts.a, 'POST', { subject: '  Cần hỗ trợ đơn hàng  ', message });
    assert.equal(result.status, 201);
    ticket = result.data.id;
    const own = await request(`/tickets/${ticket}`, accounts.a);
    assert.equal(own.status, 200);
    assert.equal(own.data.subject, 'Cần hỗ trợ đơn hàng');
    assert.equal(own.data.message, message);
    assert.equal(own.data.status, 'open');
    assert.equal(own.headers.get('cache-control'), 'no-store');
    const [[row]] = await db.query('SELECT user_id FROM support_tickets WHERE id = ?', [ticket]);
    assert.equal(row.user_id, accounts.a.id);
  });
  await check('another customer cannot list or read the ticket', async () => {
    assert.deepEqual((await request('/tickets', accounts.b)).data.tickets, []);
    assert.equal((await request(`/tickets/${ticket}`, accounts.b)).status, 404);
    assert.equal((await request('/tickets', accounts.a)).data.tickets[0].id, ticket);
  });
  await check('customer cannot impersonate another owner or set staff fields', async () => {
    for (const extra of [{ user_id: accounts.b.id }, { status: 'resolved' }, { admin_reply: 'fake' }]) {
      assert.equal((await request('/tickets', accounts.a, 'POST', { subject: 'Hi', message: 'Hi', ...extra })).status, 400);
    }
  });
  await check('empty, oversized, malformed and NUL content is rejected; Unicode limits work', async () => {
    for (const body of [null, [], {}, { subject: ' ', message: 'Hi' }, { subject: 'Hi', message: ' ' },
      { subject: 'x'.repeat(151), message: 'Hi' }, { subject: 'Hi', message: 'x'.repeat(4001) },
      { subject: 'Hi', message: '\0private' }]) {
      assert.equal((await request('/tickets', accounts.a, 'POST', body)).status, 400);
    }
    assert.equal((await request('/tickets', accounts.a, 'POST', { subject: '👋'.repeat(150), message: '👋'.repeat(4000) })).status, 201);
  });
  await check('admin inbox and updates require admin privileges', async () => {
    assert.equal((await request('/admin/tickets', accounts.a)).status, 403);
    assert.equal((await request(`/admin/tickets/${ticket}`, accounts.a, 'PATCH', { status: 'resolved' })).status, 403);
    const result = await request('/admin/tickets', accounts.admin);
    assert.equal(result.status, 200);
    assert.equal(result.data.tickets.find(row => row.id === ticket).customer_email, accounts.a.email);
  });
  await check('admin reply and status persist and become visible to the owner', async () => {
    const result = await request(`/admin/tickets/${ticket}`, accounts.admin, 'PATCH', { status: 'in_progress', reply: 'MỘC đã nhận thông tin.\nSẽ kiểm tra đơn hàng của bạn.' });
    assert.equal(result.status, 200);
    const own = (await request(`/tickets/${ticket}`, accounts.a)).data;
    assert.equal(own.status, 'in_progress');
    assert.equal(own.admin_reply, result.data.admin_reply);
    assert.ok(own.replied_at);
    assert.equal((await request(`/tickets/${ticket}`, accounts.b)).status, 404);
  });
  await check('staff updates enforce CSRF, valid IDs, status and reply limits', async () => {
    assert.equal((await request(`/admin/tickets/${ticket}`, accounts.admin, 'PATCH', { status: 'resolved' }, { 'X-CSRF-Token': '' })).status, 403);
    for (const body of [{}, { status: 'admin' }, { reply: '' }, { reply: 'x'.repeat(4001) }, { user_id: accounts.b.id }]) {
      assert.equal((await request(`/admin/tickets/${ticket}`, accounts.admin, 'PATCH', body)).status, 400);
    }
    assert.equal((await request('/tickets/1abc', accounts.a)).status, 400);
    assert.equal((await request('/tickets/2147483647', accounts.a)).status, 404);
    assert.equal((await request('/admin/tickets/2147483647', accounts.admin, 'PATCH', { status: 'open' })).status, 404);
  });
  await check('status-only and repeated no-op updates preserve the previous reply', async () => {
    const before = (await request(`/tickets/${ticket}`, accounts.a)).data;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await request(`/admin/tickets/${ticket}`, accounts.admin, 'PATCH', { status: 'resolved' });
      assert.equal(result.status, 200);
      assert.equal(result.data.admin_reply, before.admin_reply);
      assert.equal(new Date(result.data.replied_at).valueOf(), new Date(before.replied_at).valueOf());
    }
  });
  await check('cursor pagination stays bounded and never includes other customer records', async () => {
    for (let i = 0; i < 22; i++) await db.query('INSERT INTO support_tickets(user_id,subject,message) VALUES(?,?,?)', [accounts.a.id, `Yêu cầu ${i}`, 'Nội dung phân trang']);
    await db.query('INSERT INTO support_tickets(user_id,subject,message) VALUES(?,?,?)', [accounts.b.id, 'Private B', 'Private B']);
    const first = (await request('/tickets', accounts.a)).data;
    assert.equal(first.tickets.length, 20);
    assert.ok(first.nextCursor);
    const second = (await request(`/tickets?before=${first.nextCursor}`, accounts.a)).data;
    assert.equal(second.tickets.length, 4);
    assert.equal(second.nextCursor, null);
    assert.ok(second.tickets.every(row => row.id < first.nextCursor));
    assert.equal(new Set([...first.tickets, ...second.tickets].map(row => row.id)).size, 24);
    assert.ok([...first.tickets, ...second.tickets].every(row => row.subject !== 'Private B'));
    const adminPage = (await request('/admin/tickets', accounts.admin)).data;
    assert.equal(adminPage.tickets.length, 20);
    const adminNext = (await request(`/admin/tickets?before=${adminPage.nextCursor}`, accounts.admin)).data;
    assert.equal(adminNext.tickets.length, 5);
    for (const query of ['?before=0', '?before=abc', '?before=1&before=2']) assert.equal((await request(`/tickets${query}`, accounts.a)).status, 400);
  });
  await check('migration rerun preserves stored tickets and replies', async () => {
    const rows = (await db.query('SELECT * FROM support_tickets ORDER BY id'))[0];
    await migrate(db);
    assert.deepEqual((await db.query('SELECT * FROM support_tickets ORDER BY id'))[0], rows);
  });

  if (process.env.SUPPORT_UI_SMOKE === '1') {
    process.env.API_PROXY_TARGET = base;
    frontend = require('../../frontend/server').listen(0, '127.0.0.1');
    await new Promise(resolve => frontend.once('listening', resolve));
    const ui = `http://127.0.0.1:${frontend.address().port}`;
    require('../src/config/trustedOrigins').trustedOrigins.add(ui);
    const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await playwright.chromium.launch({ channel: process.env.SUPPORT_BROWSER_CHANNEL || 'chrome', headless: true });
    const output = path.resolve(__dirname, '../../test-artifacts/support');
    await fs.mkdir(output, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function signIn(session, account) {
      const token = (await (await session.request.get(`${ui}/api/auth/csrf`)).json()).csrfToken;
      const response = await session.request.post(`${ui}/api/auth/login`, { headers: { Origin: ui, 'X-CSRF-Token': token }, data: { email: account.email, password } });
      assert.equal(response.status(), 200);
    }
    await check('browser guest gets a sign-in prompt; customer sends and views a safe text ticket', async () => {
      await page.goto(`${ui}/support`);
      await page.locator('[data-support-signin]').waitFor({ state: 'visible' });
      await signIn(context, accounts.a);
      await page.reload();
      await page.locator('[data-support-content]').waitFor({ state: 'visible' });
      await page.getByLabel('Tiêu đề', { exact: true }).fill('Hỗ trợ từ trình duyệt');
      await page.getByLabel('Nội dung cần hỗ trợ', { exact: true }).fill(message);
      const pending = page.waitForResponse(response => response.url() === `${ui}/api/support/tickets` && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Gửi yêu cầu', exact: false }).click();
      const sent = await pending;
      assert.equal(sent.status(), 201);
      ticket = (await sent.json()).id;
      await page.locator(`[data-ticket-id="${ticket}"]`).waitFor();
      const card = page.locator(`[data-ticket-id="${ticket}"]`);
      await card.locator('summary').click();
      assert.equal(await card.locator('.support-ticket-body').textContent(), message);
      assert.equal(await card.locator('.support-ticket-body img').count(), 0);
      assert.equal(await page.evaluate(() => window.__supportXss), undefined);
      await page.screenshot({ path: path.join(output, 'customer-desktop.png'), fullPage: true, animations: 'disabled' });
    });
    const staffContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await signIn(staffContext, accounts.admin);
    const staff = await staffContext.newPage();
    staff.on('pageerror', error => errors.push(error.message));
    await check('browser admin reads safe text and replies; customer sees the persisted result', async () => {
      await staff.goto(`${ui}/admin/support`);
      const card = staff.locator(`[data-ticket-id="${ticket}"]`);
      await card.waitFor();
      await card.locator('summary').click();
      assert.equal(await card.locator('.support-ticket-body img').count(), 0);
      assert.equal(await staff.evaluate(() => window.__supportXss), undefined);
      await card.getByLabel('Trạng thái xử lý').selectOption('resolved');
      await card.getByLabel('Phản hồi cho khách hàng').fill('MỘC đã xử lý yêu cầu của bạn.');
      await card.getByRole('button', { name: 'Lưu phản hồi' }).click();
      await card.getByText('Đã lưu cập nhật hỗ trợ.', { exact: true }).waitFor();
      await staff.screenshot({ path: path.join(output, 'admin-desktop.png'), fullPage: true, animations: 'disabled' });
      await page.reload();
      const own = page.locator(`[data-ticket-id="${ticket}"]`);
      await own.locator('summary').click();
      assert.equal(await own.locator('.support-ticket-reply-text').textContent(), 'MỘC đã xử lý yêu cầu của bạn.');
      assert.equal(await own.locator('.support-status').textContent(), 'Đã giải quyết');
    });
    await check('customer and admin layouts fit mobile and landscape without horizontal overflow', async () => {
      for (const target of [page, staff]) {
        for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
          await target.setViewportSize(viewport);
          assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Overflow at ${viewport.width}px on ${target.url()}`);
        }
        await target.setViewportSize({ width: 375, height: 812 });
        await target.screenshot({ path: path.join(output, target === page ? 'customer-mobile.png' : 'admin-mobile.png'), fullPage: true, animations: 'disabled' });
      }
      assert.deepEqual(errors, []);
    });
    await check('customer browser is denied access to the admin inbox', async () => {
      await page.goto(`${ui}/admin/support`);
      await page.locator('[data-support-signin]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-support-content]').isVisible(), false);
      assert.equal(await page.locator('.support-ticket').count(), 0);
    });
  }
  console.log(`Support verification complete: ${checks} checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  for (const server of [frontend, backend]) if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (db) await db.end();
  if (connection) await connection.end();
  if (created) docker('rm', '-f', container);
});
