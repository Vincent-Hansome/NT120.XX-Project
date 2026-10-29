// Invoked by category-maintenance.cjs in a disposable Docker runner.
// Config arrives on stdin; never put credentials in argv or stdout.
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { migrate, inventory, snapshot, digest } = require('./category-migration.cjs');
let stage='connect';

(async () => {
  const config = JSON.parse(fs.readFileSync(0, 'utf8'));
  const db = await mysql.createConnection(config.connection);
  try {
    const info = await inventory(db);
    assert.equal(info.identity.db, config.expectedDatabase);
    if (config.expectedServerUuid) assert.equal(info.identity.uuid, config.expectedServerUuid);
    const tables = info.tables.map(t => t.TABLE_NAME);
    let result;
    switch (config.action) {
      case 'schema': {
        result={};
        for(const table of tables) {
          const [[row]]=await db.query('SHOW CREATE TABLE ??',[table]);
          result[table]=row['Create Table'];
        }
        break;
      }
      case 'inventory': {
        const state = await snapshot(db, tables);
        const [duplicates] = await db.query('SELECT MIN(id) AS keep_id, JSON_ARRAYAGG(id) AS ids FROM categories GROUP BY name HAVING COUNT(*)>1');
        const [triggers] = await db.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
        const [[objects]] = await db.query(`SELECT
          (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) AS routines,
          (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) AS events,
          (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()) AS views`);
        const definitions=[];
        for(const table of tables) {
          const [[definition]]=await db.query('SHOW CREATE TABLE ??',[table]);
          // MySQL preserves whether a charset was originally explicit in column
          // DDL. Dump/restore can make that redundant spelling explicit. Compare
          // identical charset+collation semantics without changing either DB.
          definitions.push(definition['Create Table'].replaceAll(/ CHARACTER SET utf8mb4(?= COLLATE utf8mb4_)/g,''));
        }
        const [[modes]] = await db.query('SELECT @@global.read_only AS readOnly, @@global.super_read_only AS superReadOnly, @@global.event_scheduler AS eventScheduler');
        const [otherSchemas]=await db.query(`SELECT s.SCHEMA_NAME,COUNT(t.TABLE_NAME) AS tables_count
          FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=s.SCHEMA_NAME
          WHERE s.SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys',DATABASE()) GROUP BY s.SCHEMA_NAME`);
        for(const schema of otherSchemas) {
          const [schemaTables]=await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`,[schema.SCHEMA_NAME]);
          const state={};
          for(const table of schemaTables) {
            const [rows]=await db.query('SELECT * FROM ??.?? ORDER BY id',[schema.SCHEMA_NAME,table.TABLE_NAME]);
            state[table.TABLE_NAME]=rows;
          }
          schema.digest=digest(state);
        }
        otherSchemas.sort((a,b)=>a.SCHEMA_NAME.localeCompare(b.SCHEMA_NAME));
        result = { identity: info.identity, unique: info.unique, tables: info.tables, columns: info.columns,
          references: info.references, indexes: info.indexes, duplicates, triggers, modes,
          objects, otherSchemas, schemaDigest:digest(definitions), counts: Object.fromEntries(tables.map(t => [t,state[t].length])), digest: digest(state) };
        break;
      }
      case 'freeze': {
        stage='freeze-check-existing-mode';
        const [[modes]] = await db.query('SELECT @@global.read_only AS readOnly, @@global.super_read_only AS superReadOnly, @@global.event_scheduler AS eventScheduler');
        assert.equal(modes.readOnly,config.resumeFenced ? 1 : 0,'Unexpected existing read-only state');
        assert.equal(modes.superReadOnly, 0);
        stage='freeze-check-events';
        const [[events]]=await db.query("SELECT COUNT(*) AS n FROM information_schema.EVENTS WHERE STATUS='ENABLED'");
        assert.equal(events.n,0,'Review scheduled writers first');
        stage='freeze-check-other-databases';
        const [schemas]=await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys',?)",[config.expectedDatabase]);
        assert.deepEqual(schemas.map(s=>s.SCHEMA_NAME).sort(),[...config.reviewedOtherDatabases].sort(),
          'Review other databases before a server-wide write fence');
        stage='freeze-check-sessions';
        const [sessions] = await db.query('SELECT ID, USER, DB FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND USER NOT IN (?,?)', ['event_scheduler','system user']);
        assert.equal(sessions.length, 0, 'Unexpected active database sessions; inspect before maintenance');
        stage='freeze-enable';
        await db.query('SET GLOBAL read_only=ON');
        stage='freeze-prove-application-write-rejected';
        const app = await mysql.createConnection(config.application);
        try {
          await assert.rejects(app.query('UPDATE categories SET name=name WHERE 1=0'), { code: 'ER_OPTION_PREVENTS_STATEMENT' });
          await assert.rejects(app.query('UPDATE products SET stock=stock WHERE 1=0'), { code: 'ER_OPTION_PREVENTS_STATEMENT' });
        } finally { await app.end(); }
        result = { readOnly: true, categoryAndProductWritesBlocked: true };
        break;
      }
      case 'thaw':
        await db.query('SET GLOBAL read_only=OFF');
        result = { readOnly: false };
        break;
      case 'migrate':
        result = await migrate(db, { expectedDatabase: config.expectedDatabase, expectedServerUuid: config.expectedServerUuid });
        break;
      case 'smoke': {
        const baseline = digest(await snapshot(db, tables));
        const tag = 'category-fixture-' + crypto.randomUUID();
        const password = crypto.randomBytes(30).toString('base64url');
        const hash = await require('bcrypt').hash(password, 4);
        const [user] = await db.query('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)', [tag.slice(0,50),tag+'@fixture.invalid',hash,'admin']);
        const categoryIds = new Set();
        const request = async (route, method, body, cookie) => {
          const response = await fetch(config.apiBase + route, { method, headers: {
            Origin: config.origin, 'X-CSRF-Token': csrf, 'Content-Type':'application/json', ...(cookie ? { Cookie: cookie } : {})
          }, body: JSON.stringify(body) });
          const data = await response.json();
          if (route === '/api/categories' && response.status === 201) categoryIds.add(data.id);
          return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
        };
        let csrf;
        try {
          csrf = (await (await fetch(config.apiBase+'/api/auth/csrf')).json()).csrfToken;
          const login = await request('/api/auth/login','POST',{email:tag+'@fixture.invalid',password});
          assert.equal(login.status,200); assert.ok(login.cookie);
          const a = await request('/api/categories','POST',{name:tag},login.cookie);
          assert.equal(a.status,201);
          const duplicate = await request('/api/categories','POST',{name:tag},login.cookie);
          assert.equal(duplicate.status,409);
          const b = await request('/api/categories','POST',{name:tag+'-other'},login.cookie);
          assert.equal(b.status,201);
          const rename = await request('/api/categories/'+b.data.id,'PUT',{name:tag},login.cookie);
          assert.equal(rename.status,409);
          const noop = await request('/api/categories/'+a.data.id,'PUT',{name:tag},login.cookie);
          assert.equal(noop.status,200);
          const race = await Promise.all([1,2].map(()=>request('/api/categories','POST',{name:tag+'-race'},login.cookie)));
          assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
          result = { login:200,create:201,duplicate:409,distinct:201,renameConflict:409,unchanged:200,concurrent:race.map(r=>r.status).sort() };
        } finally {
          // Recover fixture IDs even if an HTTP response is lost after commit.
          const [created] = await db.query('SELECT id FROM categories WHERE name IN (?,?,?)', [tag,tag+'-other',tag+'-race']);
          for (const row of created) categoryIds.add(row.id);
          for (const id of categoryIds) await db.query('DELETE FROM categories WHERE id=? AND name IN (?,?,?)',[id,tag,tag+'-other',tag+'-race']);
          await db.query('DELETE FROM users WHERE id=? AND email=?',[user.insertId,tag+'@fixture.invalid']);
        }
        assert.equal(digest(await snapshot(db,tables)),baseline,'Business data changed during smoke test');
        result.fixturesCleaned = true;
        result.businessDataUnchanged = true;
        break;
      }
      default: throw new Error('Unsupported action');
    }
    console.log(JSON.stringify(result));
  } finally { await db.end(); }
})().catch(error => { console.error(JSON.stringify({ error: error.code || error.name, stage, message: 'Operation failed; no SQL or private data logged' })); process.exitCode=1; });
