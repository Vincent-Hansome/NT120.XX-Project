const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { after, before, test } = require('node:test');
const vm = require('node:vm');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.NODE_ENV = 'development';
process.env.CSRF_TRUSTED_ORIGINS = 'http://localhost:3000,http://192.168.1.83:3000,https://shop.example.test';

const users = new Map();
let nextUserId = 3;
const products = [{ id: 1, name: 'Test product' }];
const categories = [{ id: 1, name: 'Test category' }];
const cartItems = [
  { id: 101, user_id: 1, quantity: 1, product_id: 1, name: 'Test product' },
  { id: 202, user_id: 2, quantity: 1, product_id: 1, name: 'Test product' }
];
const orders = [
  { id: 10, user_id: 1, total: 100, status: 'pending' },
  { id: 20, user_id: 2, total: 200, status: 'pending' }
];
const queryLog = [];
let databaseUnavailable = false;

const fakeDb = {
  async query(sql, params = []) {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    queryLog.push({ sql: normalizedSql, params: [...params] });

    if (databaseUnavailable && normalizedSql.startsWith('SELECT id, role FROM users')) {
      throw new Error('Simulated database outage');
    }

    if (normalizedSql === 'SELECT id, role FROM users WHERE id = ?') {
      const user = users.get(params[0]);
      return [user ? [{ id: user.id, role: user.role }] : []];
    }

    if (normalizedSql === 'SELECT id, name, email, role, password FROM users WHERE email = ?') {
      const user = [...users.values()].find((entry) => entry.email.toLowerCase() === params[0].toLowerCase());
      return [user ? [{ ...user }] : []];
    }

    if (normalizedSql === 'SELECT id FROM users WHERE email = ?') {
      const user = [...users.values()].find((entry) => entry.email.toLowerCase() === params[0].toLowerCase());
      return [user ? [{ id: user.id }] : []];
    }

    if (normalizedSql === 'SELECT password FROM users WHERE id = ?') {
      const user = users.get(params[0]);
      return [user ? [{ password: user.password }] : []];
    }

    if (normalizedSql === 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)') {
      const [name, email, password] = params;
      const duplicate = [...users.values()].some((entry) => entry.email.toLowerCase() === email.toLowerCase());
      if (duplicate || email === 'race@example.test') {
        const error = new Error('Duplicate email');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      const id = nextUserId++;
      users.set(id, { id, name, email, password, role: 'user', created_at: '2026-10-12' });
      return [{ insertId: id }];
    }

    if (normalizedSql === 'UPDATE users SET name = ? WHERE id = ?') {
      const [name, id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, name });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'UPDATE users SET password = ? WHERE id = ?') {
      const [password, id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, password });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'UPDATE users SET name = ?, password = ? WHERE id = ?') {
      const [name, password, id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, name, password });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'SELECT id, name, email, role, created_at FROM users WHERE id = ?') {
      const user = users.get(params[0]);
      return [user ? [{ id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at }] : []];
    }

    if (normalizedSql === 'SELECT * FROM products') return [products];
    if (normalizedSql === 'SELECT * FROM categories') return [categories];

    if (normalizedSql.includes('FROM cart_items ci') && normalizedSql.includes('WHERE ci.user_id = ?')) {
      return [cartItems.filter((item) => item.user_id === params[0])];
    }

    if (normalizedSql.startsWith('SELECT * FROM orders WHERE user_id = ?')) {
      return [orders.filter((order) => order.user_id === params[0])];
    }

    if (normalizedSql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?') {
      return [orders.filter((order) => order.id === Number(params[0]) && order.user_id === params[1])];
    }

    if (normalizedSql.includes('FROM orders o JOIN users u ON u.id = o.user_id')) {
      return [orders.map((order) => ({ ...order, customer_name: `User ${order.user_id}`, customer_email: `user${order.user_id}@example.test` }))];
    }

    throw new Error(`Unexpected SQL in test database: ${normalizedSql}`);
  }
};

const dbPath = path.resolve(__dirname, '../src/config/db.js');
const dbModule = new Module(dbPath, module);
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = fakeDb;
require.cache[dbPath] = dbModule;

const app = require('../src/app');
const server = http.createServer(app);
const { trustedOrigins } = require('../src/config/trustedOrigins');
let baseUrl;
let frontendServer;
let frontendBaseUrl;

function tokenFor(payload, options = {}, secret = process.env.JWT_SECRET) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
}

async function getCsrfToken({ viaProxy = false, origin = 'http://localhost:3000' } = {}) {
  const base = viaProxy ? frontendBaseUrl : baseUrl;
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  const response = await fetch(`${base}/api/auth/csrf`, { headers });
  const data = await response.json();
  assert.equal(response.status, 200);
  return data.csrfToken;
}

async function request(pathname, {
  token,
  authorization,
  method = 'GET',
  body,
  origin = 'http://localhost:3000',
  referer,
  csrfToken,
  omitCsrf = false,
  viaProxy = false
} = {}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (referer) headers.Referer = referer;
  if (token) headers.Cookie = `token=${token}`;
  if (authorization) headers.Authorization = authorization;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const requestMethod = method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod) && !omitCsrf) {
    headers['X-CSRF-Token'] = csrfToken || await getCsrfToken({ viaProxy, origin });
  }

  const base = viaProxy ? frontendBaseUrl : baseUrl;
  const response = await fetch(`${base}${pathname}`, {
    method: requestMethod,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { response, data };
}

before(async () => {
  const passwordHash = await bcrypt.hash('test-only-password', 4);
  users.set(1, { id: 1, name: 'Regular User', email: 'user1@example.test', role: 'user', password: passwordHash, created_at: '2026-01-01' });
  users.set(2, { id: 2, name: 'Admin User', email: 'user2@example.test', role: 'admin', password: passwordHash, created_at: '2026-01-01' });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  process.env.API_PROXY_TARGET = baseUrl;
  const frontendApp = require('../../frontend/server');
  frontendServer = http.createServer(frontendApp);
  await new Promise((resolve, reject) => {
    frontendServer.once('error', reject);
    frontendServer.listen(0, '127.0.0.1', resolve);
  });
  frontendBaseUrl = `http://127.0.0.1:${frontendServer.address().port}`;
  trustedOrigins.add(frontendBaseUrl);
});

after(async () => {
  if (frontendServer) {
    await new Promise((resolve, reject) => frontendServer.close((error) => error ? reject(error) : resolve()));
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('login signs an HS256 token for two hours and returns it in the HttpOnly cookie', async () => {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ' USER1@EXAMPLE.TEST ', password: 'test-only-password' }
  });

  assert.equal(response.status, 200);
  assert.equal(data.user.role, 'user');
  assert.equal(Object.hasOwn(data.user, 'password'), false);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=7199/i);
  assert.doesNotMatch(setCookie, /; Secure(?:;|$)/i);
  assert.doesNotMatch(setCookie, /; Domain=/i);

  const match = setCookie.match(/(?:^|,\s*)token=([^;]+)/);
  assert.ok(match, 'login should set the token cookie');
  const claims = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.id, 1);
  assert.equal(claims.role, undefined);
  assert.equal(claims.exp - claims.iat, 2 * 60 * 60);
});

test('production login marks the cookie Secure and production origins must use HTTPS', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { response } = await request('/api/auth/login', {
      method: 'POST',
      origin: 'https://shop.example.test',
      body: { email: 'user1@example.test', password: 'test-only-password' }
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /; Secure(?:;|$)/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=7199/i);
    assert.doesNotMatch(setCookie, /; Domain=/i);

    const cookieMatch = setCookie.match(/(?:^|,\s*)token=([^;]+)/);
    assert.ok(cookieMatch);
    const logout = await request('/api/users/logout', {
      token: cookieMatch[1],
      method: 'POST',
      origin: 'https://shop.example.test',
      body: {}
    });
    assert.equal(logout.response.status, 200);
    const clearedCookie = logout.response.headers.get('set-cookie');
    assert.match(clearedCookie, /token=;/);
    assert.match(clearedCookie, /; Secure(?:;|$)/i);
    assert.match(clearedCookie, /SameSite=Lax/i);
    assert.match(clearedCookie, /Path=\//i);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
  }

  const { parseTrustedOrigins } = require('../src/config/trustedOrigins');
  assert.throws(() => parseTrustedOrigins('', 'production'), /CSRF_TRUSTED_ORIGINS/);
  assert.throws(() => parseTrustedOrigins('http://localhost:3000', 'production'), /HTTPS/);
  assert.deepEqual([...parseTrustedOrigins('https://shop.example.test', 'production')], ['https://shop.example.test']);
});

test('accepts a valid cookie token and rejects missing cookie or Authorization-only credentials', async () => {
  const token = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  const accepted = await request('/api/users/me', { token });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.id, 1);

  assert.equal((await request('/api/cart')).response.status, 401);
  assert.equal((await request('/api/cart', { authorization: `Bearer ${token}` })).response.status, 401);

  const logout = await request('/api/users/logout', { token, method: 'POST', body: {} });
  assert.equal(logout.response.status, 200);
  const clearedCookie = logout.response.headers.get('set-cookie');
  assert.match(clearedCookie, /token=;/);
  assert.match(clearedCookie, /HttpOnly/i);
  assert.match(clearedCookie, /SameSite=Lax/i);
  assert.match(clearedCookie, /Path=\//i);
});

test('rejects malformed, incorrectly signed, expired, non-HS256, missing-expiry, and invalid-identity tokens', async () => {
  const future = Math.floor(Date.now() / 1000) + 300;
  const invalidTokens = [
    'not-a-jwt',
    tokenFor({ id: 1, exp: future }, {}, crypto.randomBytes(48).toString('base64url')),
    tokenFor({ id: 1 }, { expiresIn: -60 }),
    jwt.sign({ id: 1, exp: future }, process.env.JWT_SECRET, { algorithm: 'HS384' }),
    tokenFor({ id: 1 }),
    tokenFor({ exp: future })
  ];

  for (const token of invalidTokens) {
    const { response } = await request('/api/users/me', { token });
    assert.equal(response.status, 401);
  }
});

test('rejects tokens for deleted users and returns a generic service error if DB lookup fails', async () => {
  const missingUserToken = tokenFor({ id: 999, exp: Math.floor(Date.now() / 1000) + 300 });
  assert.equal((await request('/api/users/me', { token: missingUserToken })).response.status, 401);

  databaseUnavailable = true;
  try {
    const { response, data } = await request('/api/users/me', {
      token: tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(data, { message: 'Authentication service unavailable' });
  } finally {
    databaseUnavailable = false;
  }
});

test('requires CSRF proof and an allowed Origin or Referer for unsafe requests', async () => {
  const missing = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'New', email: 'new@example.test', password: 'test' },
    omitCsrf: true
  });
  assert.equal(missing.response.status, 403);

  const invalid = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'New', email: 'new@example.test', password: 'test' },
    csrfToken: 'invalid-token'
  });
  assert.equal(invalid.response.status, 403);

  const deniedOrigin = await request('/api/cart', {
    method: 'POST',
    origin: 'https://attacker.example',
    body: { product_id: 1, quantity: 1 }
  });
  assert.equal(deniedOrigin.response.status, 403);

  const noOriginOrReferer = await request('/api/auth/register', {
    method: 'POST',
    origin: null,
    body: { name: 'New', email: 'new@example.test', password: 'test' }
  });
  assert.equal(noOriginOrReferer.response.status, 403);

  const allowedReferer = await request('/api/auth/register', {
    method: 'POST',
    origin: null,
    referer: 'http://localhost:3000/register',
    body: { name: 'New', email: 'user1@example.test', password: 'LongTestPassword#2026' }
  });
  assert.equal(allowedReferer.response.status, 409);

  assert.equal((await request('/api/products', { origin: null })).response.status, 200);
});

test('allows the exact configured LAN Origin for credentialed CSRF-protected requests', async () => {
  const origin = 'http://192.168.1.83:3000';
  const result = await request('/api/auth/register', {
    method: 'POST',
    origin,
    body: { name: 'Existing User', email: 'user1@example.test', password: 'StartPassword#2026' }
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.response.headers.get('access-control-allow-origin'), origin);
  assert.equal(result.response.headers.get('access-control-allow-credentials'), 'true');
});

test('uses the current database role instead of a stale JWT role or request body role', async () => {
  const oldRoleToken = tokenFor({ id: 2, role: 'admin', exp: Math.floor(Date.now() / 1000) + 300 });
  users.set(2, { ...users.get(2), role: 'user' });
  try {
    assert.equal((await request('/api/orders/admin/all', { token: oldRoleToken })).response.status, 403);
  } finally {
    users.set(2, { ...users.get(2), role: 'admin' });
  }

  const regularUserToken = tokenFor({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 300 });
  const profileUpdate = await request('/api/users/me', {
    token: regularUserToken,
    method: 'PUT',
    body: { role: 'admin' }
  });
  assert.equal(profileUpdate.response.status, 400);
  assert.equal(users.get(1).role, 'user');

  const nameUpdate = await request('/api/users/me', {
    token: regularUserToken,
    method: 'PUT',
    body: { name: '  Updated User  ' }
  });
  assert.equal(nameUpdate.response.status, 200);
  assert.equal(users.get(1).name, 'Updated User');
  assert.equal((await request('/api/orders/admin/all', { token: regularUserToken })).response.status, 403);
});

test('keeps public catalog routes public and protects product/category writes and admin order listing', async () => {
  assert.equal((await request('/api/products')).response.status, 200);
  assert.equal((await request('/api/categories')).response.status, 200);

  const userToken = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  assert.equal((await request('/api/products/1', { token: userToken, method: 'PUT', body: { name: 'Changed' } })).response.status, 403);
  assert.equal((await request('/api/categories/1', { token: userToken, method: 'PUT', body: { name: 'Changed' } })).response.status, 403);

  const adminToken = tokenFor({ id: 2, exp: Math.floor(Date.now() / 1000) + 300 });
  const adminOrders = await request('/api/orders/admin/all', { token: adminToken });
  assert.equal(adminOrders.response.status, 200);
  assert.equal(adminOrders.data.length, 2);
});

test('cart and customer order endpoints query only the current user\'s rows', async () => {
  queryLog.length = 0;
  const token = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });

  const cart = await request('/api/cart', { token });
  assert.equal(cart.response.status, 200);
  assert.deepEqual(cart.data.map((item) => item.id), [101]);

  const myOrders = await request('/api/orders', { token });
  assert.equal(myOrders.response.status, 200);
  assert.deepEqual(myOrders.data.map((order) => order.id), [10]);

  const otherOrder = await request('/api/orders/20', { token });
  assert.equal(otherOrder.response.status, 404);

  assert.ok(queryLog.some(({ sql, params }) => sql.includes('WHERE ci.user_id = ?') && params[0] === 1));
  assert.ok(queryLog.some(({ sql, params }) => sql.startsWith('SELECT * FROM orders WHERE user_id = ?') && params[0] === 1));
  assert.ok(queryLog.some(({ sql, params }) => sql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?' && params[0] === '20' && params[1] === 1));
});

test('frontend API client obtains CSRF proof and reaches the backend through the same-origin proxy', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/api.js'), 'utf8');
  let cookieHeader = '';
  const browserFetch = async (input, options = {}) => {
    assert.equal(options.credentials, 'include');
    const headers = new Headers(options.headers || {});
    headers.set('Origin', frontendBaseUrl);
    if (cookieHeader) headers.set('Cookie', cookieHeader);

    const response = await fetch(new URL(String(input), frontendBaseUrl), { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookieHeader = setCookie.split(';', 1)[0];
    return response;
  };

  const browser = { window: { MOC_API: '/api' }, fetch: browserFetch, FormData };
  vm.runInNewContext(source, browser);

  const login = await browser.window.MocApi.request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user1@example.test', password: 'test-only-password' })
  });
  assert.equal(login.message, 'Logged in');

  const profile = await browser.window.MocApi.request('/users/me');
  assert.equal(profile.id, 1);

  const passwordChangeWithoutCurrent = await browser.window.MocApi.request('/users/me', {
    method: 'PUT',
    body: JSON.stringify({ newPassword: 'ChangedPassword#2026' })
  }).then(() => null, (error) => error);
  assert.match(passwordChangeWithoutCurrent.message, /Current and new passwords are both required/);

  const profilePage = await fetch(`${frontendBaseUrl}/profile`);
  assert.equal(profilePage.status, 200);
  assert.match(await profilePage.text(), /data-password-change-form/);
});

test('login rejects incorrect credentials with a generic 401 response', async () => {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'user1@example.test', password: 'incorrect-password' }
  });

  assert.equal(response.status, 401);
  assert.deepEqual(data, { message: 'Invalid credentials' });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('login returns controlled 400 responses for missing fields and non-string values', async () => {
  const invalidBodies = [
    {},
    { email: 'user1@example.test' },
    { email: [], password: 'test-only-password' },
    { email: 'user1@example.test', password: ['not', 'a', 'string'] },
    []
  ];

  for (const body of invalidBodies) {
    const { response } = await request('/api/auth/login', { method: 'POST', body });
    assert.equal(response.status, 400);
  }
});

test('registration validates email, name and password types and enforces the new password bounds', async () => {
  const invalidBodies = [
    { name: 'New User', email: 'not-an-email', password: 'LongPassword#2026' },
    { name: ['New', 'User'], email: 'new@example.test', password: 'LongPassword#2026' },
    { name: 'N'.repeat(51), email: 'new@example.test', password: 'LongPassword#2026' },
    { name: 'New User', email: `${'a'.repeat(89)}@example.test`, password: 'LongPassword#2026' },
    { name: 'New User', email: 'new@example.test', password: { value: 'LongPassword#2026' } },
    { name: 'New User', email: 'new@example.test', password: 'Short#123' },
    { name: 'New User', email: 'new@example.test', password: 'P'.repeat(73) }
  ];

  for (const body of invalidBodies) {
    const { response } = await request('/api/auth/register', { method: 'POST', body });
    assert.equal(response.status, 400);
  }
});

test('registration follows the schema email UNIQUE constraint; duplicate names remain allowed', async () => {
  const duplicateEmail = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Different Name', email: ' USER1@EXAMPLE.TEST ', password: 'StartPassword#2026' }
  });
  assert.equal(duplicateEmail.response.status, 409);

  const duplicateRace = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Race User', email: 'race@example.test', password: 'StartPassword#2026' }
  });
  assert.equal(duplicateRace.response.status, 409);
  assert.deepEqual(duplicateRace.data, { message: 'Account already exists' });

  const duplicateName = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Regular User', email: 'new-account@example.test', password: 'StartPassword#2026' }
  });
  assert.equal(duplicateName.response.status, 201);
  assert.equal(users.get(3).name, 'Regular User');
  assert.equal(users.get(3).email, 'new-account@example.test');
});

test('password changes require authentication, the current password and the authenticated user identity', async () => {
  const newPassword = 'ChangedPassword#2026';
  const unauthenticated = await request('/api/users/me', {
    method: 'PUT',
    body: { currentPassword: 'test-only-password', newPassword }
  });
  assert.equal(unauthenticated.response.status, 401);

  const userToken = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  const requestedOtherUser = await request('/api/users/me', {
    token: userToken,
    method: 'PUT',
    body: { id: 2, currentPassword: 'test-only-password', newPassword }
  });
  assert.equal(requestedOtherUser.response.status, 400);
  assert.equal(await bcrypt.compare('test-only-password', users.get(2).password), true);

  const missingCurrentPassword = await request('/api/users/me', {
    token: userToken,
    method: 'PUT',
    body: { newPassword }
  });
  assert.equal(missingCurrentPassword.response.status, 400);

  const wrongCurrentPassword = await request('/api/users/me', {
    token: userToken,
    method: 'PUT',
    body: { currentPassword: 'wrong-current-password', newPassword }
  });
  assert.equal(wrongCurrentPassword.response.status, 403);
});

test('password changes reject weak or oversized new passwords and do not return password hashes', async () => {
  const userToken = tokenFor({ id: 3, exp: Math.floor(Date.now() / 1000) + 300 });
  for (const newPassword of ['TooShort#1', 'P'.repeat(73), '界'.repeat(25)]) {
    const result = await request('/api/users/me', {
      token: userToken,
      method: 'PUT',
      body: { currentPassword: 'StartPassword#2026', newPassword }
    });
    assert.equal(result.response.status, 400);
  }

  const changed = await request('/api/users/me', {
    token: userToken,
    method: 'PUT',
    body: { currentPassword: 'StartPassword#2026', newPassword: 'ChangedPassword#2026' }
  });
  assert.equal(changed.response.status, 200);
  assert.deepEqual(changed.data, { message: 'Profile updated' });
  assert.equal(Object.hasOwn(changed.data, 'password'), false);
  assert.equal(await bcrypt.compare('ChangedPassword#2026', users.get(3).password), true);

  const stillValidToken = await request('/api/users/me', { token: userToken });
  assert.equal(stillValidToken.response.status, 200);

  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'new-account@example.test', password: 'ChangedPassword#2026' }
  });
  assert.equal(newPasswordLogin.response.status, 200);
});

test('login failure limit returns 429 per normalized email without blocking other accounts', async () => {
  const { AUTH_RATE_LIMITS } = require('../src/middlewares/authRateLimitMiddleware');
  const email = 'brute-force@example.test';

  for (let attempt = 0; attempt < AUTH_RATE_LIMITS.login.max; attempt += 1) {
    const { response } = await request('/api/auth/login', {
      method: 'POST',
      body: { email: attempt === 0 ? ' Brute-Force@Example.Test ' : email, password: 'WrongPassword#2026' }
    });
    assert.equal(response.status, 401);
  }

  const limited = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ' BRUTE-FORCE@EXAMPLE.TEST ', password: 'WrongPassword#2026' }
  });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);

  const otherEmail = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'different-account@example.test', password: 'WrongPassword#2026' }
  });
  assert.equal(otherEmail.response.status, 401);
});

test('registration rate limit returns 429 after its per-client IP quota', async () => {
  const { AUTH_RATE_LIMITS } = require('../src/middlewares/authRateLimitMiddleware');
  let response;

  for (let attempt = 0; attempt <= AUTH_RATE_LIMITS.register.max; attempt += 1) {
    const result = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Rate Limit Probe', email: 'user1@example.test', password: 'StartPassword#2026' }
    });
    response = result.response;
    if (response.status === 429) break;
  }

  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('register limiter trusts forwarded IPs only from the resolved frontend peer', async () => {
  const { resolveRegisterClientIp } = require('../src/middlewares/authRateLimitMiddleware');
  const frontendAddresses = async () => new Set(['172.20.0.5']);
  const proxiedRequest = {
    socket: { remoteAddress: '::ffff:172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };
  const spoofedDirectRequest = {
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };

  assert.equal(await resolveRegisterClientIp(proxiedRequest, frontendAddresses), '192.168.1.83');
  assert.equal(await resolveRegisterClientIp(spoofedDirectRequest, frontendAddresses), '127.0.0.1');
});

test('register limiter falls back to the socket IP for invalid forwarded headers or DNS failure', async () => {
  const { resolveRegisterClientIp } = require('../src/middlewares/authRateLimitMiddleware');
  const frontendAddresses = async () => new Set(['172.20.0.5']);
  const malformedForwardedRequest = {
    socket: { remoteAddress: '172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83, 10.0.0.5', 'x-real-ip': '192.168.1.83' }
  };
  const validForwardedRequest = {
    socket: { remoteAddress: '172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };

  assert.equal(await resolveRegisterClientIp(malformedForwardedRequest, frontendAddresses), '172.20.0.5');
  assert.equal(await resolveRegisterClientIp(validForwardedRequest, async () => { throw new Error('DNS unavailable'); }), '172.20.0.5');
});

test('frontend DNS resolver normalizes IPv4-mapped IPv6 and safely returns no trusted peers on failure', async () => {
  const { createFrontendAddressResolver } = require('../src/middlewares/authRateLimitMiddleware');
  const resolver = createFrontendAddressResolver({
    lookup: async () => [{ address: '::ffff:172.20.0.5', family: 6 }]
  });
  const failedResolver = createFrontendAddressResolver({
    lookup: async () => { throw new Error('DNS unavailable'); }
  });

  assert.deepEqual([...await resolver()], ['172.20.0.5']);
  assert.equal((await failedResolver()).size, 0);
});
