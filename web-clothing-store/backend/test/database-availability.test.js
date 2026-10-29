const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedDatabase } = require('../src/config/boundedDatabase');
const { checkDatabase } = require('../test-db');
const { sendDatabaseError } = require('../src/utils/databaseAvailability');
const { spawnSync } = require('node:child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(overrides = {}) {
  const calls = [];
  const connection = {
    async query() { calls.push('query'); return [[{ result: 1 }]]; },
    release() { calls.push('release'); },
    destroy() { calls.push('destroy'); },
    ...overrides
  };
  const pool = { async getConnection() { calls.push('acquire'); return connection; }, async end() {} };
  const db = createBoundedDatabase(pool, { connectionLimit: 1, queueLimit: 1, acquireTimeoutMs: 40, queryTimeoutMs: 30 });
  return { db, pool, calls, connection };
}

test('query timeout destroys the socket, never releases it, and permits a subsequent query', async () => {
  const f = fixture({ query: () => new Promise(() => {}) });
  await assert.rejects(f.db.query('SELECT 1'), { code: 'DB_QUERY_TIMEOUT' });
  assert.deepEqual(f.calls, ['acquire', 'destroy']);
  f.connection.query = async () => [[{ ok: 1 }]];
  assert.deepEqual(await f.db.query('SELECT 1'), [[{ ok: 1 }]]);
  assert.equal(f.calls.at(-1), 'release');
});

test('expired queued acquisitions are removed and do not execute SQL later', async () => {
  const f = fixture();
  const held = await f.db.getConnection();
  const pending = f.db.query('must not run');
  await assert.rejects(pending, { code: 'DB_ACQUIRE_TIMEOUT' });
  held.release();
  await sleep(5);
  assert.equal(f.calls.filter(x => x === 'acquire').length, 1);
  assert.equal(f.calls.includes('query'), false);
  await f.db.query('normal');
});

test('queue capacity rejects excess requests immediately and recovers', async () => {
  const f = fixture();
  const held = await f.db.getConnection();
  const queued = f.db.getConnection();
  await assert.rejects(f.db.getConnection(), { code: 'DB_QUEUE_FULL' });
  held.release();
  (await queued).release();
  (await f.db.getConnection()).release();
});

test('closing the database rejects queued acquisitions without opening more sockets', async () => {
  const f = fixture();
  const held = await f.db.getConnection();
  const rejected = assert.rejects(f.db.getConnection(), { code: 'DB_CONNECTION_CLOSED' });
  await f.db.end();
  await rejected;
  held.release();
  assert.equal(f.calls.filter(x => x === 'acquire').length, 1);
  await assert.rejects(f.db.getConnection(), { code: 'DB_CONNECTION_CLOSED' });
});

test('a connection arriving after the acquisition deadline is destroyed', async () => {
  const f = fixture();
  f.pool.getConnection = async () => { await sleep(70); return f.connection; };
  await assert.rejects(f.db.getConnection(), { code: 'DB_ACQUIRE_TIMEOUT' });
  await sleep(50);
  assert.deepEqual(f.calls, ['destroy']);
});

test('commit and rollback are bounded; a disposed connection cannot run more commands', async () => {
  for (const method of ['commit', 'rollback', 'beginTransaction']) {
    const f = fixture({ [method]: () => new Promise(() => {}) });
    const c = await f.db.getConnection();
    await assert.rejects(c[method](), { code: 'DB_QUERY_TIMEOUT' });
    await assert.rejects(c.query('must not run'), { code: 'DB_CONNECTION_CLOSED' });
    c.destroy(); c.release();
    assert.equal(f.calls.filter(x => x === 'destroy').length, 1);
  }
});

test('short readiness deadline does not change normal query deadline', async () => {
  const f = fixture({ async query() { await sleep(20); return [[]]; } });
  await assert.rejects(f.db.queryWithTimeout('SELECT 1', [], 5), { code: 'DB_QUERY_TIMEOUT' });
  assert.deepEqual(await f.db.query('SELECT 1'), [[]]);
});

test('test-db always closes the pool and returns failure for query or close failure', async () => {
  for (const failure of ['', 'query', 'end']) {
    const calls = [];
    const code = await checkDatabase({
      async query() { calls.push('query'); if (failure === 'query') throw new Error('secret'); },
      async end() { calls.push('end'); if (failure === 'end') throw new Error('secret'); }
    }, { log() {}, error(message) { assert.doesNotMatch(message, /secret/); } });
    assert.equal(code, failure ? 1 : 0);
    assert.deepEqual(calls, ['query', 'end']);
  }
});

test('test-db process exits nonzero for a refused database connection', () => {
  const result = spawnSync(process.execPath, ['test-db.js'], {
    cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 8000,
    env: { ...process.env, NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '1',
      DB_USER: 'test', DB_PASSWORD: 'test-only', DB_NAME: 'test', JWT_SECRET: 'test-only-secret' }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MySQL connection failed/);
  assert.doesNotMatch(result.stderr, /test-only|ECONNREFUSED/);
});

test('database availability errors map to generic 503; SQL bugs remain 500', () => {
  for (const code of ['DB_QUERY_TIMEOUT', 'DB_ACQUIRE_TIMEOUT', 'DB_QUEUE_FULL', 'ECONNREFUSED', 'ER_PARSE_ERROR']) {
    const res = { status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
    sendDatabaseError(res, { code, message: 'private SQL' });
    assert.equal(res.code, code === 'ER_PARSE_ERROR' ? 500 : 503);
    assert.doesNotMatch(JSON.stringify(res.body), /private SQL/);
  }
});
