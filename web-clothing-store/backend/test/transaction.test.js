const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');

let acquire;
const dbPath = path.resolve(__dirname, '../src/config/db.js');
const dbModule = new Module(dbPath, module);
dbModule.exports = { getConnection: () => acquire() };
dbModule.loaded = true;
require.cache[dbPath] = dbModule;
const { withTransaction, BusinessError } = require('../src/utils/transaction');

for (const failure of [null, 'acquire', 'begin', 'work', 'commit', 'rollback']) {
  test(`transaction lifecycle: ${failure || 'success'}`, async () => {
    const calls = [];
    const connection = Object.fromEntries(['beginTransaction', 'commit', 'rollback'].map(method => [method, async () => {
      calls.push(method);
      if ((failure === 'begin' && method === 'beginTransaction') || failure === method) throw new Error('private database detail');
    }]));
    connection.release = () => calls.push('release');
    connection.destroy = () => calls.push('destroy');
    acquire = async () => { calls.push('acquire'); if (failure === 'acquire') throw new Error('pool failed'); return connection; };
    const operation = withTransaction(async () => {
      calls.push('work');
      if (failure === 'work' || failure === 'rollback') throw new BusinessError(409, 'Conflict');
      return 'ok';
    });
    if (failure) await assert.rejects(operation); else assert.equal(await operation, 'ok');
    const expected = {
      success: ['acquire', 'beginTransaction', 'work', 'commit', 'release'],
      acquire: ['acquire'], begin: ['acquire', 'beginTransaction', 'release'],
      work: ['acquire', 'beginTransaction', 'work', 'rollback', 'release'],
      commit: ['acquire', 'beginTransaction', 'work', 'commit', 'rollback', 'release'],
      rollback: ['acquire', 'beginTransaction', 'work', 'rollback', 'destroy']
    };
    assert.deepEqual(calls, expected[failure || 'success']);
  });
}
