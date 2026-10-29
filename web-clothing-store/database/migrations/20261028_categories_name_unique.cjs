// Run with backend's mysql2 dependency and an administrative connection.
// External maintenance fence is mandatory: read_only=ON, application stopped,
// no other administrative writers. DDL commits independently of the DML below.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const VERSION = '20261028_categories_name_unique';
const qi = value => '`' + value.replaceAll('`', '``') + '`';

async function snapshot(connection, tables) {
  const state = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT * FROM ${qi(table)} ORDER BY id`);
    state[table] = rows;
  }
  return state;
}
function digest(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
async function inventory(connection) {
  const [[identity]] = await connection.query('SELECT DATABASE() AS db, @@server_uuid AS uuid, @@global.read_only AS readOnly');
  const [tables] = await connection.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  const [columns] = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,
    CHARACTER_SET_NAME,COLLATION_NAME,IS_NULLABLE
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const [references] = await connection.query(`SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,
    REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='categories'
    ORDER BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`);
  const [indexes] = await connection.query(`SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SUB_PART
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='categories'
    ORDER BY INDEX_NAME,SEQ_IN_INDEX`);
  const groups = Object.groupBy(indexes, row => row.INDEX_NAME);
  const unique = Object.values(groups).some(rows => rows.length === 1 && rows[0].NON_UNIQUE === 0
    && rows[0].COLUMN_NAME === 'name' && rows[0].SUB_PART === null);
  return { identity, tables, columns, references, indexes, unique };
}

async function migrate(connection, { expectedDatabase, expectedServerUuid, afterDmlCommit } = {}) {
  let locked = false, committed = false, advisory = false;
  const lockName = VERSION + ':' + crypto.createHash('sha256').update(expectedDatabase || '').digest('hex').slice(0,16);
  try {
    assert.ok(expectedDatabase && expectedServerUuid, 'Explicit database and server UUID are required');
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    assert.equal(lock.acquired, 1, 'Another migration is running');
    advisory = true;
    const info = await inventory(connection);
    assert.equal(info.identity.db, expectedDatabase, 'Wrong target database');
    assert.equal(info.identity.uuid, expectedServerUuid, 'Wrong target MySQL instance');
    assert.equal(info.identity.readOnly, 1, 'read_only maintenance fence must remain ON through DDL');
    assert.ok(info.tables.every(t => t.ENGINE === 'InnoDB'), 'Only transactional tables are supported');
    const tables = info.tables.map(t => t.TABLE_NAME);
    assert.ok(tables.includes('categories') && tables.includes('products'));
    for (const table of tables) {
      assert.ok(info.columns.some(c => c.TABLE_NAME === table && c.COLUMN_NAME === 'id'), 'Review tables without id before migration');
    }
    assert.deepEqual(info.columns.filter(c => c.TABLE_NAME === 'categories').map(c => c.COLUMN_NAME), ['id', 'name'],
      'Extra category metadata requires an explicit merge policy');
    assert.equal(info.columns.find(c => c.TABLE_NAME === 'categories' && c.COLUMN_NAME === 'name').IS_NULLABLE, 'NO');
    for (const ref of info.references) {
      assert.equal(ref.TABLE_SCHEMA, expectedDatabase, 'External category references require review');
      assert.equal(ref.REFERENCED_COLUMN_NAME, 'id', 'Only references to categories.id are supported');
      assert.equal(info.references.filter(r => r.TABLE_NAME === ref.TABLE_NAME && r.CONSTRAINT_NAME === ref.CONSTRAINT_NAME).length, 1,
        'Composite category references require review');
    }
    for (const col of info.columns.filter(c => /categor(y|ies)/i.test(c.COLUMN_NAME))) {
      assert.ok(info.references.some(r => r.TABLE_NAME === col.TABLE_NAME && r.COLUMN_NAME === col.COLUMN_NAME),
        'Undeclared category reference requires review');
    }
    const [[triggers]] = await connection.query(`SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`);
    assert.equal(triggers.n, 0, 'Review trigger side effects before migration');
    if (!info.unique) assert.ok(!info.indexes.some(i => i.INDEX_NAME === 'uq_categories_name'), 'Index name is occupied');
    // Do not BEGIN after LOCK TABLES: START TRANSACTION releases table locks.
    await connection.query('SET SESSION lock_wait_timeout=20');
    await connection.query('SET autocommit=0');
    await connection.query('LOCK TABLES ' + tables.map(t => `${qi(t)} WRITE`).join(', '));
    locked = true;
    const before = await snapshot(connection, tables);
    const [duplicates] = await connection.query(`SELECT MIN(id) AS keep_id, JSON_ARRAYAGG(id) AS ids
      FROM categories GROUP BY name HAVING COUNT(*)>1`);
    const mapping = new Map();
    for (const group of duplicates) {
      for (const id of group.ids) if (id !== group.keep_id) mapping.set(id, group.keep_id);
    }
    const refs = [...new Map(info.references.map(r => [r.TABLE_NAME + '.' + r.COLUMN_NAME, r])).values()];
    let movedLinks = 0;
    for (const ref of refs) {
      const validIds = new Set(before.categories.map(c => c.id));
      assert.ok(before[ref.TABLE_NAME].every(row => row[ref.COLUMN_NAME] === null || validIds.has(row[ref.COLUMN_NAME])),
        'Existing orphan category reference requires review');
      for (const [remove, keep] of mapping) {
        const [result] = await connection.query(`UPDATE ${qi(ref.TABLE_NAME)} SET ${qi(ref.COLUMN_NAME)}=? WHERE ${qi(ref.COLUMN_NAME)}=?`, [keep, remove]);
        movedLinks += result.affectedRows;
      }
    }
    for (const remove of mapping.keys()) await connection.query('DELETE FROM categories WHERE id=?', [remove]);
    // Compare every business column/row in memory. No customer data is logged.
    const expected = structuredClone(before);
    expected.categories = expected.categories.filter(c => !mapping.has(c.id));
    for (const ref of refs) for (const row of expected[ref.TABLE_NAME]) {
      if (mapping.has(row[ref.COLUMN_NAME])) row[ref.COLUMN_NAME] = mapping.get(row[ref.COLUMN_NAME]);
    }
    const after = await snapshot(connection, tables);
    assert.equal(digest(after), digest(expected), 'Unexpected business data change');
    await connection.commit();
    committed = true;
    // Explicit table locks plus the external server fence bridge this commit.
    // An ALTER failure cannot roll back the already committed deduplication.
    if (afterDmlCommit) await afterDmlCommit();
    if (!info.unique) await connection.query('ALTER TABLE categories ADD UNIQUE INDEX uq_categories_name (name)');
    await connection.query('UNLOCK TABLES');
    locked = false;
    await connection.query('SET autocommit=1');
    const final = await inventory(connection);
    assert.equal(final.unique, true, 'Unique index verification failed');
    const [[remaining]] = await connection.query('SELECT COUNT(*) AS n FROM (SELECT name FROM categories GROUP BY name HAVING COUNT(*)>1) AS duplicate_groups');
    assert.equal(remaining.n, 0);
    return { version: VERSION, duplicateGroups: duplicates.length, removedIds: [...mapping.keys()].sort((a,b)=>a-b),
      mapping: [...mapping].sort((a,b)=>a[0]-b[0]), movedLinks, indexAdded: !info.unique,
      beforeCounts: Object.fromEntries(tables.map(t => [t, before[t].length])),
      afterCounts: Object.fromEntries(tables.map(t => [t, after[t].length])),
      dataVerified: true, collation: final.columns.find(c => c.TABLE_NAME === 'categories' && c.COLUMN_NAME === 'name').COLLATION_NAME };
  } catch (error) {
    if (!committed) await connection.rollback().catch(() => {});
    // Suppress SQL text/rows/error messages which can contain private values.
    const safe = new Error(`Migration stopped (${error.code || error.name}); deduplication committed=${committed}. Keep maintenance fence until reviewed.`);
    safe.code = error.code || error.name;
    throw safe;
  } finally {
    if (locked) await connection.query('UNLOCK TABLES').catch(() => {});
    await connection.query('SET autocommit=1').catch(() => {});
    if (advisory) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
  }
}
module.exports = { VERSION, migrate, inventory, snapshot, digest };
