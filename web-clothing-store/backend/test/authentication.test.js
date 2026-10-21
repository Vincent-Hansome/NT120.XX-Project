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
let nextProductId = 2;
let nextCategoryId = 2;
let userUpdatesUnavailable = false;
const products = [{ id: 1, name: 'Test product', stock: 20 }];
const categories = [{ id: 1, name: 'Test category' }];
const createdUploadPaths = [];
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
let productListingUnavailable = false;

const fakeDb = {
  async query(sql, params = []) {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    queryLog.push({ sql: normalizedSql, params: [...params] });

    if (databaseUnavailable && normalizedSql.startsWith('SELECT id, role, token_version FROM users')) {
      throw new Error('Simulated database outage');
    }
    if (userUpdatesUnavailable && normalizedSql.startsWith('UPDATE users SET')) {
      throw new Error('Simulated user update failure');
    }
    if (productListingUnavailable && normalizedSql === 'SELECT * FROM products') {
      const error = new Error('Sensitive internal error message');
      error.code = 'ER_TEST_INTERNAL';
      error.sqlMessage = 'Sensitive SQL details';
      throw error;
    }

    if (normalizedSql === 'SELECT id, role, token_version FROM users WHERE id = ?') {
      const user = users.get(params[0]);
      return [user ? [{ id: user.id, role: user.role, token_version: user.token_version }] : []];
    }

    if (normalizedSql === 'SELECT id, name, email, role, password, token_version FROM users WHERE email = ?') {
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
      users.set(id, { id, name, email, password, role: 'user', token_version: 0, created_at: '2026-10-12' });
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

    if (normalizedSql === 'UPDATE users SET token_version = token_version + 1 WHERE id = ?') {
      const [id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, token_version: user.token_version + 1 });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?') {
      const [password, id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, password, token_version: user.token_version + 1 });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'UPDATE users SET name = ?, password = ?, token_version = token_version + 1 WHERE id = ?') {
      const [name, password, id] = params;
      const user = users.get(id);
      if (user) users.set(id, { ...user, name, password, token_version: user.token_version + 1 });
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (normalizedSql === 'SELECT id, name, email, role, created_at FROM users WHERE id = ?') {
      const user = users.get(params[0]);
      return [user ? [{ id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at }] : []];
    }

    if (normalizedSql === 'SELECT * FROM products') return [products];
    if (normalizedSql === 'SELECT * FROM products WHERE id = ?') {
      return [products.filter((product) => product.id === Number(params[0]))];
    }
    if (normalizedSql === 'SELECT id, stock FROM products WHERE id = ?') {
      return [products.filter((product) => product.id === Number(params[0])).map(({ id, stock }) => ({ id, stock }))];
    }
    if (normalizedSql === 'SELECT * FROM categories') return [categories];
    if (normalizedSql === 'SELECT id FROM categories WHERE id = ?') {
      return [categories.filter((category) => category.id === Number(params[0])).map(({ id }) => ({ id }))];
    }

    if (normalizedSql === 'INSERT INTO products (name, description, price, stock, size, color, image_url, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') {
      const [name, description, price, stock, size, color, image_url, category_id] = params;
      const id = nextProductId++;
      products.push({ id, name, description, price, stock, size, color, image_url, category_id });
      return [{ insertId: id }];
    }

    if (normalizedSql === 'UPDATE products SET name=?, description=?, price=?, stock=?, size=?, color=?, category_id=? WHERE id=?') {
      const [name, description, price, stock, size, color, category_id, id] = params;
      const product = products.find((entry) => entry.id === Number(id));
      if (product) Object.assign(product, { name, description, price, stock, size, color, category_id });
      return [{ affectedRows: product ? 1 : 0 }];
    }

    if (normalizedSql === 'UPDATE products SET name=?, description=?, price=?, stock=?, size=?, color=?, category_id=?, image_url=? WHERE id=?') {
      const [name, description, price, stock, size, color, category_id, image_url, id] = params;
      const product = products.find((entry) => entry.id === Number(id));
      if (product) Object.assign(product, { name, description, price, stock, size, color, category_id, image_url });
      return [{ affectedRows: product ? 1 : 0 }];
    }

    if (normalizedSql === 'DELETE FROM products WHERE id = ?') {
      const index = products.findIndex((product) => product.id === Number(params[0]));
      if (index >= 0) products.splice(index, 1);
      return [{ affectedRows: index >= 0 ? 1 : 0 }];
    }

    if (normalizedSql === 'INSERT INTO categories (name) VALUES (?)') {
      const [name] = params;
      if (categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
        const error = new Error('Duplicate category name');
        error.code = 'ER_DUP_ENTRY';
        error.sqlMessage = 'Internal fake database detail';
        throw error;
      }
      const id = nextCategoryId++;
      categories.push({ id, name });
      return [{ insertId: id }];
    }

    if (normalizedSql === 'UPDATE categories SET name = ? WHERE id = ?') {
      const [name, id] = params;
      if (categories.some((category) => category.id !== Number(id) && category.name.toLowerCase() === name.toLowerCase())) {
        const error = new Error('Duplicate category name');
        error.code = 'ER_DUP_ENTRY';
        error.sqlMessage = 'Internal fake database detail';
        throw error;
      }
      const category = categories.find((entry) => entry.id === Number(id));
      if (category) category.name = name;
      return [{ affectedRows: category ? 1 : 0 }];
    }

    if (normalizedSql === 'DELETE FROM categories WHERE id = ?') {
      const index = categories.findIndex((category) => category.id === Number(params[0]));
      if (index >= 0) categories.splice(index, 1);
      return [{ affectedRows: index >= 0 ? 1 : 0 }];
    }

    if (normalizedSql.includes('FROM cart_items ci') && normalizedSql.includes('WHERE ci.user_id = ?')) {
      return [cartItems.filter((item) => item.user_id === params[0])];
    }

    if (normalizedSql === 'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?') {
      return [cartItems
        .filter((item) => item.user_id === params[0] && item.product_id === params[1])
        .map(({ id, quantity }) => ({ id, quantity }))];
    }

    if (normalizedSql.startsWith('SELECT ci.id, p.stock FROM cart_items ci')) {
      return [cartItems
        .filter((item) => item.id === params[0] && item.user_id === params[1])
        .map((item) => ({ id: item.id, stock: products.find((product) => product.id === item.product_id)?.stock }))];
    }

    if (normalizedSql === 'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?') {
      const [quantity, id, userId] = params;
      const item = cartItems.find((entry) => entry.id === id && entry.user_id === userId);
      if (item) item.quantity = quantity;
      return [{ affectedRows: item ? 1 : 0 }];
    }

    if (normalizedSql === 'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)') {
      const [userId, productId, quantity] = params;
      const id = Math.max(0, ...cartItems.map((item) => item.id)) + 1;
      cartItems.push({ id, user_id: userId, product_id: productId, quantity, name: 'Test product' });
      return [{ insertId: id }];
    }

    if (normalizedSql === 'DELETE FROM cart_items WHERE id = ? AND user_id = ?') {
      const index = cartItems.findIndex((item) => item.id === params[0] && item.user_id === params[1]);
      if (index >= 0) cartItems.splice(index, 1);
      return [{ affectedRows: index >= 0 ? 1 : 0 }];
    }

    if (normalizedSql.startsWith('SELECT * FROM orders WHERE user_id = ?')) {
      return [orders.filter((order) => order.user_id === params[0])];
    }

    if (normalizedSql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?') {
      return [orders.filter((order) => order.id === Number(params[0]) && order.user_id === params[1])];
    }

    if (normalizedSql.startsWith('SELECT oi.*, p.name, p.image_url FROM order_items oi')) return [[]];

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
  return jwt.sign({ tokenVersion: 0, ...payload }, secret, { algorithm: 'HS256', ...options });
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
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json';
  const requestMethod = method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod) && !omitCsrf) {
    headers['X-CSRF-Token'] = csrfToken || await getCsrfToken({ viaProxy, origin });
  }

  const base = viaProxy ? frontendBaseUrl : baseUrl;
  const response = await fetch(`${base}${pathname}`, {
    method: requestMethod,
    headers,
    body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body)
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
  users.set(1, { id: 1, name: 'Regular User', email: 'user1@example.test', role: 'user', password: passwordHash, token_version: 0, created_at: '2026-01-01' });
  users.set(2, { id: 2, name: 'Admin User', email: 'user2@example.test', role: 'admin', password: passwordHash, token_version: 0, created_at: '2026-01-01' });
  users.set(10, { id: 10, name: 'Logout User', email: 'logout@example.test', role: 'user', password: passwordHash, token_version: 0, created_at: '2026-01-01' });
  users.set(11, { id: 11, name: 'Version User', email: 'version@example.test', role: 'user', password: passwordHash, token_version: 1, created_at: '2026-01-01' });
  users.set(12, { id: 12, name: 'Logout Failure User', email: 'logout-failure@example.test', role: 'user', password: passwordHash, token_version: 0, created_at: '2026-01-01' });
  users.set(13, { id: 13, name: 'Password Failure User', email: 'password-failure@example.test', role: 'user', password: passwordHash, token_version: 0, created_at: '2026-01-01' });
  users.set(14, { id: 14, name: 'Production Cookie User', email: 'production@example.test', role: 'user', password: passwordHash, token_version: 0, created_at: '2026-01-01' });

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
  await Promise.all(createdUploadPaths.map((filePath) => fs.promises.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  })));
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
  assert.equal(claims.tokenVersion, 0);
  assert.equal(claims.role, undefined);
  assert.equal(claims.email, undefined);
  assert.equal(claims.password, undefined);
  assert.equal(claims.exp - claims.iat, 2 * 60 * 60);
});

test('production login marks the cookie Secure and production origins must use HTTPS', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { response } = await request('/api/auth/login', {
      method: 'POST',
      origin: 'https://shop.example.test',
      body: { email: 'production@example.test', password: 'test-only-password' }
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
  const token = tokenFor({ id: 10, exp: Math.floor(Date.now() / 1000) + 300 });
  const copiedToken = tokenFor({ id: 10, exp: Math.floor(Date.now() / 1000) + 300 });
  const accepted = await request('/api/users/me', { token });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.id, 10);
  assert.equal((await request('/api/users/me', { token: copiedToken })).response.status, 200);

  assert.equal((await request('/api/cart')).response.status, 401);
  assert.equal((await request('/api/cart', { authorization: `Bearer ${token}` })).response.status, 401);

  const logout = await request('/api/users/logout', { token, method: 'POST', body: {} });
  assert.equal(logout.response.status, 200);
  assert.equal(users.get(10).token_version, 1);
  assert.ok(queryLog.some(({ sql, params }) => sql === 'UPDATE users SET token_version = token_version + 1 WHERE id = ?' && params[0] === 10));
  const clearedCookie = logout.response.headers.get('set-cookie');
  assert.match(clearedCookie, /token=;/);
  assert.match(clearedCookie, /HttpOnly/i);
  assert.match(clearedCookie, /SameSite=Lax/i);
  assert.match(clearedCookie, /Path=\//i);

  assert.equal((await request('/api/users/me', { token })).response.status, 401);
  assert.equal((await request('/api/users/me', { token: copiedToken })).response.status, 401);
});

test('rejects old and malformed token versions', async () => {
  const future = Math.floor(Date.now() / 1000) + 300;
  const invalidTokens = [
    jwt.sign({ id: 1, exp: future }, process.env.JWT_SECRET, { algorithm: 'HS256' }),
    tokenFor({ id: 1, tokenVersion: '0', exp: future }),
    tokenFor({ id: 1, tokenVersion: -1, exp: future }),
    tokenFor({ id: 1, tokenVersion: 0.5, exp: future })
  ];

  for (const token of invalidTokens) {
    assert.equal((await request('/api/users/me', { token })).response.status, 401);
  }

  const staleToken = tokenFor({ id: 11, tokenVersion: 0, exp: future });
  assert.equal((await request('/api/users/me', { token: staleToken })).response.status, 401);
});

test('logout database failure does not report success or clear the still-valid session', async () => {
  const token = tokenFor({ id: 12, exp: Math.floor(Date.now() / 1000) + 300 });
  userUpdatesUnavailable = true;
  try {
    const failedLogout = await request('/api/users/logout', { token, method: 'POST', body: {} });
    assert.equal(failedLogout.response.status, 500);
    assert.deepEqual(failedLogout.data, { message: 'Server error' });
    assert.equal(failedLogout.response.headers.get('set-cookie'), null);
  } finally {
    userUpdatesUnavailable = false;
  }

  assert.equal((await request('/api/users/me', { token })).response.status, 200);
  assert.equal(users.get(12).token_version, 0);
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
  assert.equal((await request('/api/users/me', { token: regularUserToken })).response.status, 200);
  assert.equal((await request('/api/orders/admin/all', { token: regularUserToken })).response.status, 403);
});

test('profile returns only the authenticated user fields and rejects mass-assignment fields', async () => {
  const originalUser = { ...users.get(1) };
  const originalAdmin = { ...users.get(2) };
  const userToken = tokenFor({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 300 });
  const adminToken = tokenFor({ id: 2, exp: Math.floor(Date.now() / 1000) + 300 });

  try {
    queryLog.length = 0;
    const profile = await request('/api/users/me', { token: userToken });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.data.id, 1);
    assert.equal(profile.data.role, 'user');
    assert.deepEqual(Object.keys(profile.data).sort(), ['created_at', 'email', 'id', 'name', 'role']);
    assert.ok(queryLog.some(({ sql, params }) => sql === 'SELECT id, name, email, role, created_at FROM users WHERE id = ?' && params[0] === 1));

    const adminProfile = await request('/api/users/me', { token: adminToken });
    assert.equal(adminProfile.response.status, 200);
    assert.equal(adminProfile.data.id, 2);
    assert.equal(adminProfile.data.role, 'admin');

    queryLog.length = 0;
    const validUpdate = await request('/api/users/me', {
      token: userToken,
      method: 'PUT',
      body: { name: 'Profile Owner Updated' }
    });
    assert.equal(validUpdate.response.status, 200);
    assert.equal(users.get(1).name, 'Profile Owner Updated');
    assert.equal(users.get(2).name, originalAdmin.name);
    assert.ok(queryLog.some(({ sql, params }) => sql === 'UPDATE users SET name = ? WHERE id = ?' && params[0] === 'Profile Owner Updated' && params[1] === 1));

    const updatedUser = { ...users.get(1) };
    const forbiddenFields = [
      { role: 'admin' },
      { token_version: 9 },
      { user_id: 2 },
      { id: 2 },
      { password: 'attacker-controlled-value' },
      { email: 'attacker@example.test' },
      { created_at: '2030-01-01' }
    ];
    for (const forbiddenField of forbiddenFields) {
      queryLog.length = 0;
      const update = await request('/api/users/me', {
        token: userToken,
        method: 'PUT',
        body: { name: 'Injected Name', ...forbiddenField }
      });
      assert.equal(update.response.status, 400, Object.keys(forbiddenField)[0]);
      assert.deepEqual(users.get(1), updatedUser);
      assert.deepEqual(users.get(2), originalAdmin);
      assert.equal(queryLog.some(({ sql }) => sql.startsWith('UPDATE users SET')), false);
    }
  } finally {
    users.set(1, originalUser);
    users.set(2, originalAdmin);
  }
});

test('keeps public catalog routes public and protects product/category writes and admin order listing', async () => {
  assert.equal((await request('/api/products')).response.status, 200);
  assert.equal((await request('/api/categories')).response.status, 200);

  const userToken = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  assert.equal((await request('/api/products/1', { token: userToken, method: 'PUT', body: { name: 'Changed' } })).response.status, 403);
  assert.equal((await request('/api/categories/1', { token: userToken, method: 'PUT', body: { name: 'Changed' } })).response.status, 403);

  const deniedWrites = [
    ['/api/products', 'POST', productPayload()],
    ['/api/products/1', 'DELETE'],
    ['/api/categories', 'POST', { name: 'Unauthorized category' }],
    ['/api/categories/1', 'DELETE']
  ];
  for (const [pathname, method, body] of deniedWrites) {
    const queryStart = queryLog.length;
    const result = await request(pathname, { token: userToken, method, body });
    assert.equal(result.response.status, 403, `${method} ${pathname}`);
    assert.deepEqual(catalogWriteQueriesSince(queryStart), []);
  }

  const invalidIdForNonAdmin = await request('/api/products/not-an-id', {
    token: userToken,
    method: 'PUT',
    body: productPayload()
  });
  assert.equal(invalidIdForNonAdmin.response.status, 403);

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

  const ownOrder = await request('/api/orders/10', { token });
  assert.equal(ownOrder.response.status, 200);
  assert.equal(ownOrder.data.order.id, 10);
  assert.deepEqual(ownOrder.data.items, []);

  const otherOrder = await request('/api/orders/20', { token });
  assert.equal(otherOrder.response.status, 404);

  assert.ok(queryLog.some(({ sql, params }) => sql.includes('WHERE ci.user_id = ?') && params[0] === 1));
  assert.ok(queryLog.some(({ sql, params }) => sql.startsWith('SELECT * FROM orders WHERE user_id = ?') && params[0] === 1));
  assert.ok(queryLog.some(({ sql, params }) => sql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?' && params[0] === 10 && typeof params[0] === 'number' && params[1] === 1));
  assert.ok(queryLog.some(({ sql, params }) => sql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?' && params[0] === 20 && typeof params[0] === 'number' && params[1] === 1));
});

test('cart item reads and mutations are scoped to the authenticated user and validate IDs and quantities', async () => {
  const originalCartItems = cartItems.map((item) => ({ ...item }));
  const userAToken = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  const userBToken = tokenFor({ id: 2, exp: Math.floor(Date.now() / 1000) + 300 });

  try {
    queryLog.length = 0;
    const userACart = await request('/api/cart', { token: userAToken });
    assert.equal(userACart.response.status, 200);
    assert.deepEqual(userACart.data.map((item) => item.id), [101]);
    assert.ok(queryLog.some(({ sql, params }) => sql.includes('WHERE ci.user_id = ?') && params[0] === 1));

    const otherUserCart = await request('/api/cart', { token: userBToken });
    assert.equal(otherUserCart.response.status, 200);
    assert.deepEqual(otherUserCart.data.map((item) => item.id), [202]);

    queryLog.length = 0;
    const forbiddenUpdate = await request('/api/cart/202', {
      token: userAToken,
      method: 'PUT',
      body: { quantity: 3, user_id: 2 }
    });
    assert.equal(forbiddenUpdate.response.status, 404);
    assert.equal(cartItems.find((item) => item.id === 202).quantity, 1);
    assert.equal(queryLog.some(({ sql }) => sql.startsWith('UPDATE cart_items')), false);
    assert.ok(queryLog.some(({ sql, params }) => sql.startsWith('SELECT ci.id, p.stock FROM cart_items ci') && params[0] === 202 && params[1] === 1));

    const forbiddenDelete = await request('/api/cart/202', { token: userAToken, method: 'DELETE' });
    assert.equal(forbiddenDelete.response.status, 404);
    assert.ok(cartItems.some((item) => item.id === 202 && item.user_id === 2));
    assert.ok(queryLog.some(({ sql, params }) => sql === 'DELETE FROM cart_items WHERE id = ? AND user_id = ?' && params[0] === 202 && params[1] === 1));

    const added = await request('/api/cart', {
      token: userAToken,
      method: 'POST',
      body: { product_id: 1, quantity: 1, user_id: 2 }
    });
    assert.equal(added.response.status, 201);
    assert.equal(cartItems.find((item) => item.id === 101).quantity, 2);
    assert.equal(cartItems.find((item) => item.id === 202).quantity, 1);
    assert.ok(queryLog.some(({ sql, params }) => sql === 'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?' && params[0] === 2 && params[1] === 101 && params[2] === 1));

    const updated = await request('/api/cart/101', {
      token: userAToken,
      method: 'PUT',
      body: { quantity: 4, user_id: 2 }
    });
    assert.equal(updated.response.status, 200);
    assert.equal(cartItems.find((item) => item.id === 101).quantity, 4);
    assert.equal(cartItems.find((item) => item.id === 202).quantity, 1);

    const deleted = await request('/api/cart/101', { token: userAToken, method: 'DELETE' });
    assert.equal(deleted.response.status, 200);
    assert.equal(cartItems.some((item) => item.id === 101), false);
    assert.ok(cartItems.some((item) => item.id === 202 && item.user_id === 2));

    for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
      const queryStart = queryLog.length;
      const put = await request(`/api/cart/${id}`, { token: userAToken, method: 'PUT', body: { quantity: 1 } });
      const remove = await request(`/api/cart/${id}`, { token: userAToken, method: 'DELETE' });
      assert.equal(put.response.status, 400, `PUT ID ${id}`);
      assert.equal(remove.response.status, 400, `DELETE ID ${id}`);
      assert.equal(queryLog.slice(queryStart).some(({ sql }) => sql.includes('cart_items')), false);
    }

    for (const quantity of [0, -1, 1.5, 'not-a-number', 2147483648, true, {}]) {
      const queryStart = queryLog.length;
      const response = await request('/api/cart/101', {
        token: userAToken,
        method: 'PUT',
        body: { quantity }
      });
      assert.equal(response.response.status, 400, `PUT quantity ${String(quantity)}`);
      assert.equal(queryLog.slice(queryStart).some(({ sql }) => sql.includes('cart_items')), false);
    }

    for (const product_id of ['abc', '0', '-1', '1.5', '2147483648']) {
      const queryStart = queryLog.length;
      const response = await request('/api/cart', {
        token: userAToken,
        method: 'POST',
        body: { product_id, quantity: 1 }
      });
      assert.equal(response.response.status, 400, `product_id ${product_id}`);
      assert.equal(queryLog.slice(queryStart).some(({ sql }) => sql.includes('cart_items') || sql === 'SELECT id, stock FROM products WHERE id = ?'), false);
    }

    for (const quantity of [0, -1, 1.5, 'not-a-number', 2147483648, true, {}]) {
      const queryStart = queryLog.length;
      const response = await request('/api/cart', {
        token: userAToken,
        method: 'POST',
        body: { product_id: 1, quantity }
      });
      assert.equal(response.response.status, 400, `POST quantity ${String(quantity)}`);
      assert.equal(queryLog.slice(queryStart).some(({ sql }) => sql.includes('cart_items') || sql === 'SELECT id, stock FROM products WHERE id = ?'), false);
    }
  } finally {
    cartItems.splice(0, cartItems.length, ...originalCartItems);
  }
});

test('order detail rejects malformed IDs after authentication and before order queries', async () => {
  const { isValidId, validateIdParam } = require('../src/middlewares/idValidationMiddleware');
  const token = tokenFor({ id: 1, exp: Math.floor(Date.now() / 1000) + 300 });
  const invalidIds = ['abc', '0', '-1', '1.5', '2147483648'];

  assert.equal(isValidId(''), false);
  let emptyIdStatus;
  validateIdParam(
    { params: { id: '' } },
    {
      status(status) { emptyIdStatus = status; return this; },
      json(body) { this.body = body; return this; }
    },
    () => assert.fail('Empty ID must not reach the next middleware')
  );
  assert.equal(emptyIdStatus, 400);

  const unauthenticated = await request('/api/orders/abc');
  assert.equal(unauthenticated.response.status, 401);

  queryLog.length = 0;
  for (const id of invalidIds) {
    const { response } = await request(`/api/orders/${id}`, { token });
    assert.equal(response.status, 400, `ID ${id}`);
  }

  assert.equal(queryLog.some(({ sql }) => sql === 'SELECT * FROM orders WHERE id = ? AND user_id = ?'), false);
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

  const browser = {
    window: {},
    document: { querySelector: () => ({ content: '/api' }) },
    fetch: browserFetch,
    FormData
  };
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

  const invalidatedToken = await request('/api/users/me', { token: userToken });
  assert.equal(invalidatedToken.response.status, 401);

  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'new-account@example.test', password: 'ChangedPassword#2026' }
  });
  assert.equal(newPasswordLogin.response.status, 200);
  const newLoginCookie = newPasswordLogin.response.headers.get('set-cookie').match(/(?:^|,\s*)token=([^;]+)/);
  assert.ok(newLoginCookie);
  const newLoginClaims = jwt.verify(newLoginCookie[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  assert.equal(newLoginClaims.tokenVersion, 1);
  assert.equal((await request('/api/users/me', { token: newLoginCookie[1] })).response.status, 200);
});

test('password change database failure leaves password and session version unchanged', async () => {
  const token = tokenFor({ id: 13, exp: Math.floor(Date.now() / 1000) + 300 });
  userUpdatesUnavailable = true;
  try {
    const failedChange = await request('/api/users/me', {
      token,
      method: 'PUT',
      body: { currentPassword: 'test-only-password', newPassword: 'ChangedPassword#2026' }
    });
    assert.equal(failedChange.response.status, 500);
    assert.deepEqual(failedChange.data, { message: 'Server error' });
  } finally {
    userUpdatesUnavailable = false;
  }

  assert.equal(users.get(13).token_version, 0);
  assert.equal(await bcrypt.compare('test-only-password', users.get(13).password), true);
  assert.equal(await bcrypt.compare('ChangedPassword#2026', users.get(13).password), false);
  assert.equal((await request('/api/users/me', { token })).response.status, 200);
});

test('login failure limit is keyed by trusted client IP rather than account email', async () => {
  const { createLoginRateLimit } = require('../src/middlewares/authRateLimitMiddleware');
  const loginRateLimit = createLoginRateLimit({
    max: 2,
    resolveClientIp: async (req) => req.clientIp
  });

  async function attempt(clientIp, email) {
    let finish;
    const response = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      once(event, callback) { if (event === 'finish') finish = callback; }
    };

    await loginRateLimit(
      { clientIp, body: { email }, socket: { remoteAddress: '127.0.0.1' } },
      response,
      () => {
        response.statusCode = 401;
        finish();
      }
    );
    return response;
  }

  assert.equal((await attempt('192.0.2.10', 'target@example.test')).statusCode, 401);
  assert.equal((await attempt('192.0.2.10', 'different@example.test')).statusCode, 401);
  const limited = await attempt('192.0.2.10', 'third@example.test');
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['Retry-After']) > 0);
  assert.equal((await attempt('192.0.2.11', 'target@example.test')).statusCode, 401);
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
  const { resolveClientIp } = require('../src/middlewares/authRateLimitMiddleware');
  const frontendAddresses = async () => new Set(['172.20.0.5']);
  const proxiedRequest = {
    socket: { remoteAddress: '::ffff:172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };
  const spoofedDirectRequest = {
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };

  assert.equal(await resolveClientIp(proxiedRequest, frontendAddresses), '192.168.1.83');
  assert.equal(await resolveClientIp(spoofedDirectRequest, frontendAddresses), '127.0.0.1');
});

test('register limiter falls back to the socket IP for invalid forwarded headers or DNS failure', async () => {
  const { resolveClientIp } = require('../src/middlewares/authRateLimitMiddleware');
  const frontendAddresses = async () => new Set(['172.20.0.5']);
  const malformedForwardedRequest = {
    socket: { remoteAddress: '172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83, 10.0.0.5', 'x-real-ip': '192.168.1.83' }
  };
  const validForwardedRequest = {
    socket: { remoteAddress: '172.20.0.5' },
    headers: { 'x-forwarded-for': '192.168.1.83', 'x-real-ip': '192.168.1.83' }
  };

  assert.equal(await resolveClientIp(malformedForwardedRequest, frontendAddresses), '172.20.0.5');
  assert.equal(await resolveClientIp(validForwardedRequest, async () => { throw new Error('DNS unavailable'); }), '172.20.0.5');
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

function adminToken() {
  return tokenFor({ id: 2, exp: Math.floor(Date.now() / 1000) + 300 });
}

function productPayload(overrides = {}) {
  return {
    name: 'Linen shirt',
    description: 'Natural linen',
    price: '125.50',
    stock: '4',
    size: 'M',
    color: 'Sand',
    category_id: '1',
    ...overrides
  };
}

function multipartProduct(payload, image) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  if (image) form.append('image', new Blob([image.bytes], { type: image.mimeType }), image.filename);
  return form;
}

function catalogWriteQueriesSince(index) {
  return queryLog.slice(index).filter(({ sql }) => /\b(?:products|categories)\b/i.test(sql));
}

function uploadDirectoryEntries() {
  return fs.readdirSync(path.resolve(__dirname, '../uploads')).sort();
}

test('product validation rejects invalid values before writing to the database', async () => {
  const invalidProducts = [
    { name: '   ' },
    { name: 123 },
    { name: 'n'.repeat(256) },
    { price: '-1' },
    { price: 'not-a-number' },
    { price: 'NaN' },
    { price: 'Infinity' },
    { price: '-Infinity' },
    { price: '1e309' },
    { price: '1.001' },
    { price: '100000000.00' },
    { stock: '-1' },
    { stock: 'NaN' },
    { stock: 'Infinity' },
    { stock: '1e3' },
    { stock: '1.5' },
    { stock: '2147483648' },
    { description: { html: 'unexpected object' } },
    { description: 'd'.repeat(10001) },
    { size: 's'.repeat(51) },
    { color: 'c'.repeat(51) },
    { category_id: 'not-an-id' },
    { category_id: '0' },
    { category_id: '2147483648' },
    { id: 999 },
    { image_url: '/uploads/client-controlled.png' },
    { created_at: '2030-01-01' },
    { role: 'admin' }
  ];
  const token = adminToken();

  for (const overrides of invalidProducts) {
    const queryStart = queryLog.length;
    const { response, data } = await request('/api/products', {
      token,
      method: 'POST',
      body: productPayload(overrides)
    });
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(typeof data.message, 'string');
    assert.deepEqual(catalogWriteQueriesSince(queryStart), []);
  }

  const queryStart = queryLog.length;
  const unknownCategory = await request('/api/products', {
    token,
    method: 'POST',
    body: productPayload({ category_id: '999' })
  });
  assert.equal(unknownCategory.response.status, 400);
  assert.ok(catalogWriteQueriesSince(queryStart).some(({ sql }) => sql === 'SELECT id FROM categories WHERE id = ?'));
  assert.equal(catalogWriteQueriesSince(queryStart).some(({ sql }) => sql.startsWith('INSERT INTO products')), false);
});

test('controller database failures preserve generic responses and log only safe error metadata', async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  productListingUnavailable = true;

  try {
    const { response, data } = await request('/api/products');
    assert.equal(response.status, 500);
    assert.deepEqual(data, { message: 'Server error' });
    assert.deepEqual(logged, [['[productController.getAll] failed', { code: 'ER_TEST_INTERNAL' }]]);
    assert.doesNotMatch(JSON.stringify(logged), /Sensitive internal error message|Sensitive SQL details/);
  } finally {
    productListingUnavailable = false;
    console.error = originalConsoleError;
  }
});

test('product validation accepts schema boundary values and zero price/stock', async () => {
  const token = adminToken();
  const boundaryPayload = productPayload({
    name: 'N'.repeat(255),
    description: 'd'.repeat(10000),
    price: '99999999.99',
    stock: '2147483647',
    size: 'S'.repeat(50),
    color: 'C'.repeat(50),
    category_id: '1'
  });
  const boundary = await request('/api/products', { token, method: 'POST', body: boundaryPayload });
  assert.equal(boundary.response.status, 201);
  const product = products.find((entry) => entry.id === boundary.data.id);
  assert.equal(product.name.length, 255);
  assert.equal(product.description.length, 10000);
  assert.equal(product.price, 99999999.99);
  assert.equal(product.stock, 2147483647);
  assert.equal(product.size.length, 50);
  assert.equal(product.color.length, 50);

  const boundaryUpdate = await request(`/api/products/${boundary.data.id}`, {
    token,
    method: 'PUT',
    body: boundaryPayload
  });
  assert.equal(boundaryUpdate.response.status, 200);
  assert.equal(product.price, 99999999.99);
  assert.equal(product.stock, 2147483647);

  const zeroValues = await request('/api/products', {
    token,
    method: 'POST',
    body: productPayload({ price: '0', stock: '0' })
  });
  assert.equal(zeroValues.response.status, 201);
  const zeroProduct = products.find((entry) => entry.id === zeroValues.data.id);
  assert.equal(zeroProduct.price, 0);
  assert.equal(zeroProduct.stock, 0);
});

test('valid product create and full-form update remain compatible with the admin payload', async () => {
  const token = adminToken();
  const created = await request('/api/products', {
    token,
    method: 'POST',
    body: productPayload({ name: '  Linen shirt  ' })
  });

  assert.equal(created.response.status, 201);
  const product = products.find((entry) => entry.id === created.data.id);
  assert.equal(product.name, 'Linen shirt');
  assert.equal(product.price, 125.5);
  assert.equal(product.stock, 4);
  assert.equal(product.category_id, 1);

  const form = multipartProduct({
    name: 'Updated linen shirt',
    description: 'Updated description',
    price: '200',
    stock: '0',
    size: 'L',
    color: 'Olive',
    category_id: ''
  });
  const updated = await request(`/api/products/${created.data.id}`, {
    token,
    method: 'PUT',
    body: form
  });

  assert.equal(updated.response.status, 200);
  assert.equal(product.name, 'Updated linen shirt');
  assert.equal(product.price, 200);
  assert.equal(product.stock, 0);
  assert.equal(product.category_id, null);

  const queryStart = queryLog.length;
  const unsupportedUpdate = await request(`/api/products/${created.data.id}`, {
    token,
    method: 'PUT',
    body: productPayload({ id: 999, image_url: '/uploads/client-controlled.png', created_at: '2030-01-01' })
  });
  assert.equal(unsupportedUpdate.response.status, 400);
  assert.equal(product.name, 'Updated linen shirt');
  assert.equal(product.image_url, null);
  assert.deepEqual(catalogWriteQueriesSince(queryStart), []);

  const invalidCategoryStart = queryLog.length;
  const invalidCategoryUpdate = await request(`/api/products/${created.data.id}`, {
    token,
    method: 'PUT',
    body: productPayload({ name: 'Should not update', category_id: '999' })
  });
  assert.equal(invalidCategoryUpdate.response.status, 400);
  assert.equal(product.name, 'Updated linen shirt');
  assert.ok(catalogWriteQueriesSince(invalidCategoryStart).some(({ sql }) => sql === 'SELECT id FROM categories WHERE id = ?'));
  assert.equal(catalogWriteQueriesSince(invalidCategoryStart).some(({ sql }) => sql.startsWith('UPDATE products')), false);

  const partial = await request(`/api/products/${created.data.id}`, {
    token,
    method: 'PUT',
    body: { name: 'Partial update only' }
  });
  assert.equal(partial.response.status, 400);
  assert.equal(product.name, 'Updated linen shirt');
});

test('invalid product and category route ids are rejected before catalog writes', async () => {
  const token = adminToken();
  for (const [pathname, method, body] of [
    ['/api/products/not-an-id', 'PUT', productPayload()],
    ['/api/products/0', 'DELETE'],
    ['/api/categories/1.5', 'PUT', { name: 'Changed' }],
    ['/api/categories/2147483648', 'DELETE']
  ]) {
    const queryStart = queryLog.length;
    const { response } = await request(pathname, { token, method, body });
    assert.equal(response.status, 400, `${method} ${pathname}`);
    assert.deepEqual(catalogWriteQueriesSince(queryStart), []);
  }

  const invalidPublicId = await request('/api/products/1xyz');
  assert.equal(invalidPublicId.response.status, 400);
});

test('category names are trimmed, bounded, type checked, and duplicate names return 409', async () => {
  const token = adminToken();
  const invalidBodies = [
    { name: '' },
    { name: '   ' },
    { name: 12 },
    { name: 'c'.repeat(101) },
    { name: { value: 'object' } },
    {},
    { name: 'Unapproved fields', id: 999 },
    { name: 'Unapproved fields', description: 'ignored data' }
  ];
  for (const body of invalidBodies) {
    const queryStart = queryLog.length;
    const { response } = await request('/api/categories', { token, method: 'POST', body });
    assert.equal(response.status, 400);
    assert.deepEqual(catalogWriteQueriesSince(queryStart), []);
  }

  const created = await request('/api/categories', {
    token,
    method: 'POST',
    body: { name: '  Denim  ' }
  });
  assert.equal(created.response.status, 201);
  assert.equal(categories.find((entry) => entry.id === created.data.id).name, 'Denim');

  const maxLengthName = 'C'.repeat(100);
  const maxLength = await request('/api/categories', {
    token,
    method: 'POST',
    body: { name: maxLengthName }
  });
  assert.equal(maxLength.response.status, 201);
  assert.equal(categories.find((entry) => entry.id === maxLength.data.id).name.length, 100);

  const duplicate = await request('/api/categories', {
    token,
    method: 'POST',
    body: { name: 'denim' }
  });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.data.message, /already exists/i);
  assert.doesNotMatch(JSON.stringify(duplicate.data), /Internal fake database detail|sqlMessage/i);

  const duplicateUpdate = await request('/api/categories/1', {
    token,
    method: 'PUT',
    body: { name: 'DENIM' }
  });
  assert.equal(duplicateUpdate.response.status, 409);

  const unsupportedUpdate = await request(`/api/categories/${created.data.id}`, {
    token,
    method: 'PUT',
    body: { name: 'Injected category', id: 999 }
  });
  assert.equal(unsupportedUpdate.response.status, 400);
  assert.equal(categories.find((entry) => entry.id === created.data.id).name, 'Denim');

  const updated = await request(`/api/categories/${created.data.id}`, {
    token,
    method: 'PUT',
    body: { name: '  Denim jackets  ' }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(categories.find((entry) => entry.id === created.data.id).name, 'Denim jackets');
});

test('image upload verifies and re-encodes actual raster content under a server-generated name', async () => {
  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 130, g: 90, b: 45 } }
  }).png().toBuffer();
  const created = await request('/api/products', {
    token: adminToken(),
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: png,
      filename: '../../user-controlled-name.png',
      mimeType: 'image/png'
    })
  });

  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const product = products.find((entry) => entry.id === created.data.id);
  assert.match(product.image_url, /^\/uploads\/[0-9a-f-]{36}\.png$/i);
  const imagePath = path.resolve(__dirname, '../uploads', product.image_url.slice('/uploads/'.length));
  createdUploadPaths.push(imagePath);
  assert.equal((await sharp(await fs.promises.readFile(imagePath)).metadata()).format, 'png');
});

test('Sharp loader allowlist preserves JPEG, PNG, and WebP uploads', async () => {
  const sharp = require('sharp');
  const formats = [
    { format: 'jpeg', filename: 'product.jpg', mimeType: 'image/jpeg', outputExtension: '.jpg' },
    { format: 'png', filename: 'product.png', mimeType: 'image/png', outputExtension: '.png' },
    { format: 'webp', filename: 'product.webp', mimeType: 'image/webp', outputExtension: '.webp' }
  ];

  for (const image of formats) {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 90, g: 120, b: 150 } }
    }).toFormat(image.format).toBuffer();
    const created = await request('/api/products', {
      token: adminToken(),
      method: 'POST',
      body: multipartProduct(productPayload(), {
        bytes,
        filename: image.filename,
        mimeType: image.mimeType
      })
    });

    assert.equal(created.response.status, 201, `${image.format}: ${JSON.stringify(created.data)}`);
    const product = products.find((entry) => entry.id === created.data.id);
    assert.ok(product.image_url.endsWith(image.outputExtension));
    const imagePath = path.resolve(__dirname, '../uploads', product.image_url.slice('/uploads/'.length));
    createdUploadPaths.push(imagePath);
    assert.equal((await sharp(await fs.promises.readFile(imagePath)).metadata()).format, image.format);
  }
});

test('spoofed image contents, MIME mismatches, SVG, and oversized images are rejected and cleaned up', async () => {
  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 20, b: 30 } }
  }).png().toBuffer();
  const baseline = uploadDirectoryEntries();
  const token = adminToken();

  const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  await assert.rejects(sharp(svgBytes).metadata());

  const fakeImage = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: Buffer.from('<html>not an image</html>'),
      filename: 'fake.png',
      mimeType: 'image/png'
    })
  });
  assert.equal(fakeImage.response.status, 415);

  const extensionMismatch = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: png,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg'
    })
  });
  assert.equal(extensionMismatch.response.status, 415);

  const mimeMismatch = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: png,
      filename: 'photo.jpg',
      mimeType: 'image/png'
    })
  });
  assert.equal(mimeMismatch.response.status, 415);

  const disguisedSvg = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: svgBytes,
      filename: 'image.png',
      mimeType: 'image/png'
    })
  });
  assert.equal(disguisedSvg.response.status, 415);

  const svg = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      filename: 'image.svg',
      mimeType: 'image/svg+xml'
    })
  });
  assert.equal(svg.response.status, 415);

  const tooLarge = await request('/api/products', {
    token,
    method: 'POST',
    body: multipartProduct(productPayload(), {
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      filename: 'too-large.png',
      mimeType: 'image/png'
    })
  });
  assert.equal(tooLarge.response.status, 413);
  assert.deepEqual(uploadDirectoryEntries(), baseline);
});

test('product field validation failure removes an already normalized uploaded image', async () => {
  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 80, g: 90, b: 100 } }
  }).png().toBuffer();
  const baseline = uploadDirectoryEntries();
  const response = await request('/api/products', {
    token: adminToken(),
    method: 'POST',
    body: multipartProduct(productPayload({ name: '   ' }), {
      bytes: png,
      filename: 'valid.png',
      mimeType: 'image/png'
    })
  });

  assert.equal(response.response.status, 400);
  assert.deepEqual(uploadDirectoryEntries(), baseline);
});
