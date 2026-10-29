// Fixed-target Docker maintenance for this deployment. Credentials stay in memory/stdin.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../..');
const runner = 'nt120-category-runner-20261028';
const testServer = 'nt120-category-mysql-20261028';
const backupRoot = path.resolve(root,'../web-clothing-store-backups');
const expectedUuid = '290bb158-c262-11f1-bd83-5a080e03a6aa';
function docker(args, input, binary=false) {
  const r = spawnSync('docker',args,{input,encoding:binary?undefined:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
  if (r.error || r.status !== 0) {
    let diagnostic='';
    try { const safe=JSON.parse(String(r.stderr).trim()); if(safe.error && safe.stage) diagnostic=' ['+safe.error+', '+safe.stage+']'; } catch {}
    throw new Error('Docker operation failed: '+args.slice(0,2).join(' ')+diagnostic+' (private details suppressed)');
  }
  return r.stdout;
}
const inspect = name => JSON.parse(docker(['inspect',name]))[0];
const envOf = container => Object.fromEntries(container.Config.Env.map(v => { const i=v.indexOf('='); return [v.slice(0,i),v.slice(i+1)]; }));
function copyTools() {
  docker(['exec',runner,'mkdir','-p','/app/test/category-ops']);
  docker(['cp',path.join(root,'database/migrations/20261028_categories_name_unique.cjs'),runner+':/app/test/category-ops/category-migration.cjs']);
  docker(['cp',path.join(__dirname,'category-db-worker.cjs'),runner+':/app/test/category-ops/category-db-worker.cjs']);
}
function liveConfig() {
  const backend = inspect('webapp_backend'), db = inspect('webapp_db');
  const appEnv=envOf(backend), dbEnv=envOf(db);
  assert.equal(appEnv.DB_HOST,'db'); assert.equal(appEnv.DB_NAME,'web-clothing-store');
  const net = Object.keys(backend.NetworkSettings.Networks).find(n => db.NetworkSettings.Networks[n]);
  assert.ok(net);
  return { backend, net, appEnv, connection:{host:'db',user:'root',password:dbEnv.MYSQL_ROOT_PASSWORD,database:appEnv.DB_NAME},
    application:{host:'db',user:appEnv.DB_USER,password:appEnv.DB_PASSWORD,database:appEnv.DB_NAME},
    expectedDatabase:appEnv.DB_NAME,expectedServerUuid:expectedUuid,
    reviewedOtherDatabases:['webapp_lab','web_clothing_store_concurrency_test_20261016',
      'web_clothing_store_schema_validation_20261019','web_clothing_store_schema_validation_20261020_224506',
      'web_clothing_store_fk_dryrun_20261020_230508_306'] };
}
function worker(action, config) {
  const {connection,application,expectedDatabase,expectedServerUuid,resumeFenced,reviewedOtherDatabases,apiBase,origin}=config;
  return JSON.parse(docker(['exec','-i',runner,'node','test/category-ops/category-db-worker.cjs'],JSON.stringify({action,
    connection,application,expectedDatabase,expectedServerUuid,resumeFenced,reviewedOtherDatabases,apiBase,origin})));
}
function testConfig(database='nt120_category_restore') {
  return { connection:{host:testServer,user:'root',password:'category-root-test-only',database}, expectedDatabase:database };
}
function sql(container, sqlText, passwordEnv='MYSQL_ROOT_PASSWORD') {
  // Fixed shell command; SQL on stdin and password expanded only inside container.
  return docker(['exec','-i',container,'sh','-c',`MYSQL_PWD="$${passwordEnv}" exec mysql -u root --batch --skip-column-names`],sqlText);
}
function backup() {
  fs.mkdirSync(backupRoot,{recursive:true});
  // Remove inherited ACLs and grant only the current Windows identity access.
  const identity=spawnSync('powershell',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true,encoding:'utf8'});
  assert.equal(identity.status,0);
  const sid=identity.stdout.trim();
  assert.match(sid,/^S-1-[\d-]+$/);
  const acl=spawnSync('icacls',[backupRoot,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,encoding:'utf8'});
  if (acl.status!==0) throw new Error('Could not restrict backup directory ACL');
  const bytes = docker(['exec','webapp_db','sh','-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root --single-transaction --quick --hex-blob --skip-add-drop-table --set-gtid-purged=OFF --no-tablespaces --skip-lock-tables --skip-add-locks --skip-disable-keys --skip-triggers web-clothing-store categories users products orders cart_items order_items'],undefined,true);
  // No database selection, DROP, FK bypass, seed or sensitive console output.
  assert.ok(bytes.length>1000);
  const text=bytes.toString('utf8');
  assert.ok(!/\b(?:DROP TABLE|CREATE DATABASE|USE `)/i.test(text));
  // mysqldump adds FK/unique-check toggles even when flags above are set. They
  // are unnecessary for this acyclic schema; restore keeps every FK enabled.
  const safe = text.split(/\r?\n/).filter(line => !/FOREIGN_KEY_CHECKS|UNIQUE_CHECKS/.test(line)).join('\n');
  const file=path.join(backupRoot,'categories-'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'.sql');
  fs.writeFileSync(file,safe,{flag:'wx'});
  const sha256=crypto.createHash('sha256').update(safe).digest('hex');
  fs.writeFileSync(file+'.sha256',sha256+'\n',{flag:'wx'});
  return {file,sha256,bytes:Buffer.byteLength(safe)};
}
function restoreBackup(saved, expected) {
  const bytes=fs.readFileSync(saved.file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),saved.sha256);
  const dump=bytes.toString('utf8');
  assert.ok(!/FOREIGN_KEY_CHECKS|\bDROP\s+(?:TABLE|DATABASE)|\bCREATE DATABASE|^USE\s/im.test(dump),'Unsafe restore directives');
  const restore='nt120_category_restore_'+Date.now();
  sql(testServer,'CREATE DATABASE `'+restore+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n');
  sql(testServer,'USE `'+restore+'`;\n'+dump);
  const config=testConfig(restore);
  const restored=worker('inventory',config);
  assert.equal(restored.digest,expected.digest,'Backup restore data mismatch');
  assert.equal(restored.schemaDigest,expected.schemaDigest,'Backup restore full schema mismatch');
  assert.deepEqual(restored.indexes,expected.indexes,'Restored indexes mismatch');
  assert.deepEqual(restored.columns,expected.columns,'Restored columns/collations mismatch');
  assert.deepEqual(restored.references.map(({TABLE_SCHEMA,...r})=>r),expected.references.map(({TABLE_SCHEMA,...r})=>r),'Restored FK mismatch');
  return {restore,config,restored};
}

(async () => {
  const action=process.argv[2];
  const config=liveConfig();
  if (action==='prepare') {
    // Names must be unused: never reuse/reset an unrelated container/database.
    docker(['run','-d','--name',testServer,'--label','nt120.purpose=category-migration-tests','--network',config.net,
      '--tmpfs','/var/lib/mysql','-p','127.0.0.1:13317:3306','-e','MYSQL_ROOT_PASSWORD=category-root-test-only',
      '-e','MYSQL_DATABASE=nt120_category_test','-e','MYSQL_USER=category_test','-e','MYSQL_PASSWORD=category-app-test-only',
      'mysql:8.0','--log-bin-trust-function-creators=1']);
    docker(['run','-d','--name',runner,'--label','nt120.purpose=category-migration-runner','--network',config.net,
      '--entrypoint','tail',config.backend.Config.Image,'-f','/dev/null']);
    copyTools();
    console.log(JSON.stringify({testServer,runner,port:13317}));
  } else if (action==='inspect') {
    copyTools(); console.log(JSON.stringify(worker('inventory',config),null,2));
  } else if (action==='smoke') {
    copyTools();
    const {appEnv}=config;
    console.log(JSON.stringify(worker('smoke',{...config,apiBase:'http://webapp_backend:3001',origin:appEnv.CSRF_TRUSTED_ORIGINS.split(',')[0].trim()}),null,2));
  } else if (action==='diagnose-restore') {
    copyTools();
    const restore=sql(testServer,"SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'nt120_category_restore_%' ORDER BY SCHEMA_NAME DESC LIMIT 1;").trim();
    assert.match(restore,/^nt120_category_restore_\d+$/);
    const original=worker('schema',config), restored=worker('schema',testConfig(restore));
    console.log(JSON.stringify({restore,differences:Object.keys(original).filter(t=>original[t]!==restored[t]).map(t=>({table:t,original:original[t],restored:restored[t]}))},null,2));
  } else if (action==='restore-backup') {
    copyTools();
    const file=path.resolve(process.argv[3]||'');
    const relative=path.relative(backupRoot,file);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Backup must be in the private backup directory');
    const report=JSON.parse(fs.readFileSync(file+'.report.json','utf8'));
    assert.equal(report.backup.file,file);
    assert.equal(fs.readFileSync(file+'.sha256','utf8').trim(),report.backup.sha256);
    const verified=restoreBackup(report.backup,report.before);
    console.log(JSON.stringify({restoreDatabase:verified.restore,restoreVerified:true,counts:verified.restored.counts}));
  } else if (action==='apply') {
    copyTools();
    const preflight=worker('inventory',config);
    assert.equal(preflight.identity.uuid,expectedUuid);
    assert.equal(preflight.triggers.length,0,'Backup routine requires trigger review');
    assert.deepEqual(preflight.objects,{routines:0,events:0,views:0},'Review additional database objects before backup');
    if(preflight.identity.readOnly===1) {
      assert.ok(process.argv.includes('--resume-fenced'),'Existing maintenance fence: explicitly review before resuming');
      assert.equal(config.backend.State.Running,false,'Backend must already be stopped');
      config.resumeFenced=true;
    }
    // Backend must stay stopped if any subsequent operation fails.
    docker(['stop','--time','30','webapp_backend']);
    console.log('Backend stopped; acquiring server write fence.');
    console.log(JSON.stringify(worker('freeze',config)));
    const before=worker('inventory',config);
    const saved=backup();
    console.log(JSON.stringify({backup:saved}));
    const {restore,config:restoredConfig,restored}=restoreBackup(saved,before);
    sql(testServer,'SET GLOBAL read_only=ON;\n');
    const rehearsal=worker('migrate',{...restoredConfig,expectedServerUuid:restored.identity.uuid});
    const rehearsalState=worker('inventory',restoredConfig);
    const rerun=worker('migrate',{...restoredConfig,expectedServerUuid:restored.identity.uuid});
    assert.equal(worker('inventory',restoredConfig).digest,rehearsalState.digest);
    assert.equal(rerun.duplicateGroups,0); assert.equal(rerun.indexAdded,false);
    console.log(JSON.stringify({restoreVerified:true,rehearsal,rerun}));
    const applied=worker('migrate',config);
    const after=worker('inventory',config);
    assert.equal(after.digest,rehearsalState.digest,'Live result differs from verified rehearsal');
    assert.deepEqual(after.otherSchemas,before.otherSchemas,'Other database data changed during maintenance');
    const report={backup:saved,restoreDatabase:restore,serverUuid:expectedUuid,before,after,rehearsal,rerun,applied,restoreVerified:true};
    fs.writeFileSync(saved.file+'.report.json',JSON.stringify(report,null,2),{flag:'wx'});
    // Only resume after all checks pass. Failure deliberately leaves maintenance ON.
    console.log(JSON.stringify(worker('thaw',config)));
    docker(['start','webapp_backend']);
    console.log(JSON.stringify({applied,report:saved.file+'.report.json',backendRestarted:true}));
  } else throw new Error('Use prepare, inspect, apply, smoke, restore-backup or diagnose-restore');
})().catch(error=>{console.error('Maintenance stopped: '+error.message);process.exitCode=1;});
