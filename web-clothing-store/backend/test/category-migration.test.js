const assert = require('node:assert/strict');
const { before, after, describe, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrate, inventory, snapshot, digest } = require('../../database/migrations/20261028_categories_name_unique.cjs');

describe('category migration and API on isolated real MySQL', { skip: process.env.RUN_CATEGORY_MYSQL_TESTS !== '1' }, () => {
  const database = 'nt120_category_test_' + crypto.randomBytes(5).toString('hex');
  const adminConfig = { host:'127.0.0.1',port:13317,user:'root',password:'category-root-test-only',database,multipleStatements:true };
  const appConfig = { ...adminConfig,user:'category_test',password:'category-app-test-only',multipleStatements:false };
  Object.assign(process.env, { NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_PORT:'13317',DB_NAME:database,
    DB_USER:appConfig.user,DB_PASSWORD:appConfig.password,JWT_SECRET:crypto.randomBytes(48).toString('hex'),
    CSRF_TRUSTED_ORIGINS:'http://localhost:13330' });
  let root, appConnection, info, original, migratedDigest, db, server, base, csrf, cookie;
  const tag='Category '+crypto.randomUUID();
  const email='category-'+crypto.randomUUID()+'@fixture.invalid';
  before(async () => {
    const mysql=require('mysql2/promise');
    root=await mysql.createConnection({...adminConfig,database:undefined});
    // This dedicated test server can also contain rehearsal restores fenced ON.
    await root.query('SET GLOBAL read_only=OFF');
    assert.match(database,/^nt120_category_test_[a-f0-9]{10}$/);
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    await root.query(`GRANT ALL ON \`${database}\`.* TO 'category_test'@'%'`);
    await root.changeUser({database});
    const [[target]]=await root.query('SELECT DATABASE() AS db,@@version AS version');
    assert.equal(target.db,database); assert.match(target.version,/^8\./);
    const [[existing]]=await root.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.equal(existing.n,0,'Requires a fresh isolated test database; never reset an existing database');
    const schema=await fs.readFile(path.resolve(__dirname,'../../database/schema.sql'),'utf8');
    const tables=schema.slice(schema.indexOf('-- =========================')).replace('name VARCHAR(100) NOT NULL UNIQUE','name VARCHAR(100) NOT NULL');
    await root.query(tables);
    // Additional declared reference verifies inventory-driven remapping.
    await root.query(`CREATE TABLE category_links(id INT PRIMARY KEY,category_id INT,
      FOREIGN KEY(category_id) REFERENCES categories(id));
      INSERT INTO categories(id,name) VALUES(10,'Tést'),(20,'test '),(30,'Different');
      INSERT INTO products(id,name,price,stock,category_id) VALUES
        (10,'Keep fixture',12.34,5,10),(20,'Move fixture',56.78,9,20),(30,'Null fixture',0,0,NULL);
      INSERT INTO category_links VALUES(1,10),(2,20),(3,NULL);
      INSERT INTO users(id,name,email,password) VALUES(10,'Migration fixture','migration@fixture.invalid','unused');
      INSERT INTO orders(id,user_id,total) VALUES(10,10,56.78);
      INSERT INTO order_items(id,order_id,product_id,quantity,price) VALUES(10,10,20,1,56.78);
      INSERT INTO cart_items(id,user_id,product_id,quantity) VALUES(10,10,20,2)`);
    info=await inventory(root);
    original=await snapshot(root,info.tables.map(t=>t.TABLE_NAME));
    appConnection=await mysql.createConnection(appConfig);
  });
  after(async () => {
    if(root) await root.query('SET GLOBAL read_only=OFF');
    if(server) await new Promise(resolve=>server.close(resolve));
    if(db) await db.end();
    if(appConnection) await appConnection.end();
    if(root) await root.end();
  });
  const run=extra=>migrate(root,{expectedDatabase:database,expectedServerUuid:info.identity.uuid,...extra});
  async function request(route, method, name) {
    const response=await fetch(base+'/api/categories'+route,{method,headers:{
      Origin:'http://localhost:13330','X-CSRF-Token':csrf,Cookie:cookie,'Content-Type':'application/json'
    },body:JSON.stringify({name})});
    return {status:response.status,data:await response.json()};
  }
  test('refuses to mutate without a server write fence or with the wrong target',async()=>{
    await assert.rejects(run());
    await root.query('SET GLOBAL read_only=ON');
    await assert.rejects(migrate(root,{expectedDatabase:'wrong_database',expectedServerUuid:info.identity.uuid}));
    assert.equal(digest(await snapshot(root,info.tables.map(t=>t.TABLE_NAME))),digest(original));
  });
  test('legacy collation duplicates retain minimum ID; every link and all business data survive',async()=>{
    let bridgeChecked=false;
    const result=await run({ afterDmlCommit:async()=>{
      // Real competing connections after DML COMMIT, before DDL implicit commit.
      await assert.rejects(appConnection.query("INSERT INTO categories(name) VALUES('Blocked fixture')"),{code:'ER_OPTION_PREVENTS_STATEMENT'});
      await assert.rejects(appConnection.query('UPDATE products SET stock=stock WHERE id=10'),{code:'ER_OPTION_PREVENTS_STATEMENT'});
      bridgeChecked=true;
    }});
    assert.equal(bridgeChecked,true);
    assert.deepEqual(result.mapping,[[20,10]]); assert.equal(result.movedLinks,2);
    assert.equal(result.collation,'utf8mb4_general_ci'); assert.equal(result.indexAdded,true);
    const expected=structuredClone(original);
    expected.categories=expected.categories.filter(c=>c.id!==20);
    expected.products.find(p=>p.id===20).category_id=10;
    expected.category_links.find(p=>p.id===2).category_id=10;
    const afterState=await snapshot(root,info.tables.map(t=>t.TABLE_NAME));
    assert.deepEqual(afterState,expected);
    const [[orphan]]=await root.query(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c
      ON c.id=p.category_id WHERE p.category_id IS NOT NULL AND c.id IS NULL`);
    assert.equal(orphan.n,0);
    migratedDigest=digest(afterState);
  });
  test('second run is a no-op and an equivalent unique index under another name is accepted',async()=>{
    await root.query('ALTER TABLE categories RENAME INDEX uq_categories_name TO existing_name_unique');
    const result=await run();
    assert.equal(result.duplicateGroups,0); assert.equal(result.movedLinks,0); assert.equal(result.indexAdded,false);
    assert.equal(digest(await snapshot(root,info.tables.map(t=>t.TABLE_NAME))),migratedDigest);
    await root.query('SET GLOBAL read_only=OFF');
    // Exercise the complete app/middleware stack with normal fixture login.
    db=require('../src/config/db');
    const password='isolated-category-fixture-password';
    const hash=await require('bcrypt').hash(password,4);
    await root.query('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',[tag.slice(0,50),email,hash,'admin']);
    server=require('../src/app').listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${server.address().port}`;
    csrf=(await (await fetch(base+'/api/auth/csrf')).json()).csrfToken;
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:13330','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(login.status,200); cookie=login.headers.get('set-cookie').split(';')[0];
  });
  let category;
  test('create succeeds and duplicate name under the actual collation returns 409',async()=>{
    category=await request('','POST',tag); assert.equal(category.status,201);
    assert.equal((await request('','POST',tag)).status,409);
    assert.equal((await request('','POST','TEST')).status,409);
  });
  test('rename to an existing name returns 409 and preserves both records',async()=>{
    const other=await request('','POST',tag+' other'); assert.equal(other.status,201);
    assert.equal((await request('/'+other.data.id,'PUT',tag)).status,409);
    const [[row]]=await root.query('SELECT name FROM categories WHERE id=?',[other.data.id]);
    assert.equal(row.name,tag+' other');
  });
  test('two concurrent creates yield exactly one 201 and one 409',async()=>{
    const results=await Promise.all([request('','POST',tag+' race'),request('','POST',tag+' race')]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const [[row]]=await root.query('SELECT COUNT(*) AS n FROM categories WHERE name=?',[tag+' race']);
    assert.equal(row.n,1);
  });
  test('a distinct name and an unchanged update succeed',async()=>{
    assert.equal((await request('','POST',tag+' distinct')).status,201);
    assert.equal((await request('/'+category.data.id,'PUT',tag)).status,200);
  });
});
