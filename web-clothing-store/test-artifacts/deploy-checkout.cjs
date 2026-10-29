// Local, explicit deployment helper. Run only after tests and image builds pass.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=path.resolve(root,'../web-clothing-store-backups',`checkout-${stamp}`);
const restore=`nt120-checkout-backup-${Date.now()}`;
const network=restore+'-net';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const docker=(...args)=>execFileSync('docker',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000}).trim();
const compose=(...args)=>docker('compose','--env-file','docker/.env','-f','docker/docker-compose.yml',...args);
function sql(container,query){
  return docker('exec',container,'sh','-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --default-character-set=utf8mb4 --user=root --batch --raw --skip-column-names "$MYSQL_DATABASE" --execute="$1"','sh',query);
}
const tables=['users','categories','products','cart_items','orders','order_items'];
function getColumns(container){
  return Object.fromEntries(tables.map(t=>[t,sql(container,`SHOW COLUMNS FROM \`${t}\``).split('\n').map(line=>line.split('\t')[0])]));
}
function snapshot(container,columns){
  return Object.fromEntries(tables.map(t=>{
    const fields=columns[t].map(c=>{assert.match(c,/^[a-z_]+$/);return `'${c}',\`${c}\``;}).join(',');
    const rows=sql(container,`SELECT JSON_OBJECT(${fields}) FROM \`${t}\` ORDER BY id`);
    return [t,{count:rows?rows.split('\n').length:0,sha256:hash(rows)}];
  }));
}
function images(folder){
  const entries=[];
  function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,item.name);
    if(item.isDirectory())walk(full);
    else if(item.isFile())entries.push({path:path.relative(folder,full).replaceAll('\\','/'),sha256:hash(fs.readFileSync(full))});
  }}
  walk(folder);return entries.sort((a,b)=>a.path.localeCompare(b.path));
}
function stageMigration(){
  console.log(docker('run','--rm','--network',network,
    '-e','NODE_ENV=test','-e',`DB_HOST=${restore}`,'-e','DB_NAME=restore_check',
    '-e','DB_USER=restore_app','-e','DB_PASSWORD=restore-app-test-only',
    '-e','JWT_SECRET=restore-migration-test-only','docker-backend','node','scripts/migrate-checkout.cjs'));
}
let stopped=false,created=false,deployed=false;
async function main(){
  if(!process.argv.includes('--apply'))throw new Error('Explicit --apply required');
  const initial=JSON.parse(docker('inspect','webapp_backend'))[0];
  assert.equal(initial.State.Running,true);
  fs.mkdirSync(backup,{recursive:false});
  const sid=execFileSync('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
  assert.match(sid,/^S-1-[\d-]+$/);
  execFileSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true});
  const oldImages={backend:initial.Image,frontend:JSON.parse(docker('inspect','webapp_frontend'))[0].Image};
  fs.writeFileSync(path.join(backup,'old-images.json'),JSON.stringify(oldImages,null,2));
  fs.copyFileSync(path.join(root,'docker/.env'),path.join(backup,'docker.env'));
  docker('stop','webapp_backend');stopped=true;
  const columns=getColumns('webapp_db');
  const before=snapshot('webapp_db',columns);
  const uploadSource=path.join(root,'backend/uploads');
  const beforeImages=images(uploadSource);
  docker('exec','webapp_db','sh','-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --default-character-set=utf8mb4 --user=root --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --result-file=/tmp/nt120-checkout-backup.sql "$MYSQL_DATABASE"');
  const dump=path.join(backup,'database.sql');
  docker('cp','webapp_db:/tmp/nt120-checkout-backup.sql',dump);
  assert.ok(fs.statSync(dump).size>0);
  fs.cpSync(uploadSource,path.join(backup,'uploads'),{recursive:true});
  assert.deepEqual(images(path.join(backup,'uploads')),beforeImages);
  fs.writeFileSync(dump+'.sha256',hash(fs.readFileSync(dump))+'\n');
  console.log('Backup created:',backup);
  docker('network','create',network);
  docker('run','-d','--name',restore,'--label','nt120.purpose=checkout-backup-rehearsal',
    '--network',network,'--tmpfs','/var/lib/mysql','-e','MYSQL_DATABASE=restore_check',
    '-e','MYSQL_ROOT_PASSWORD=restore-root-test-only','-e','MYSQL_USER=restore_app',
    '-e','MYSQL_PASSWORD=restore-app-test-only','mysql:8.0');created=true;
  let ready=false;
  for(let i=0;i<60;i++){
    try{docker('exec',restore,'sh','-c','export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqladmin ping --host=127.0.0.1 --user=root --silent');ready=true;break;}
    catch{await sleep(500);}
  }
  assert.ok(ready,'Backup rehearsal DB did not start');
  docker('cp',dump,restore+':/tmp/backup.sql');
  docker('exec',restore,'sh','-c','export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --default-character-set=utf8mb4 --user=root "$MYSQL_DATABASE" < /tmp/backup.sql');
  assert.deepEqual(snapshot(restore,columns),before);
  stageMigration();stageMigration();
  assert.deepEqual(snapshot(restore,columns),before);
  console.log('Backup restored and additive migration rehearsed twice; all original row hashes match.');
  console.log(compose('run','--rm','--no-deps','backend','node','scripts/migrate-checkout.cjs'));
  assert.deepEqual(snapshot('webapp_db',columns),before);
  assert.deepEqual(images(uploadSource),beforeImages);
  fs.writeFileSync(path.join(backup,'verification.json'),JSON.stringify({backup,columns,before,
    after:snapshot('webapp_db',columns),images:beforeImages,sqlSha256:hash(fs.readFileSync(dump)),oldImages},null,2));
  console.log(compose('up','-d','--no-deps','backend','frontend'));deployed=true;
  for(let i=0;i<60;i++){
    const b=JSON.parse(docker('inspect','webapp_backend'))[0],f=JSON.parse(docker('inspect','webapp_frontend'))[0];
    if(b.State.Health?.Status==='healthy'&&f.State.Health?.Status==='healthy'){
      console.log('Backend/frontend healthy. Backup:',backup);return;
    }
    await sleep(1000);
  }
  throw new Error('Deployment did not become healthy within 60 seconds');
}
main().catch(error=>{
  console.error('Deployment stopped:',error.message);process.exitCode=1;
  if(stopped&&!deployed){try{docker('start','webapp_backend');console.log('Previous backend restarted; additive schema retained if already applied.');}catch{console.error('Backend requires manual recovery');}}
}).finally(()=>{if(created){docker('stop',restore);console.log('Stopped backup rehearsal container:',restore);}});
