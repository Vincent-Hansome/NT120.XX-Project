// Snapshot metadata contains source hashes and image IDs, never runtime secrets.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const backupDirectory=path.resolve(root,'../web-clothing-store-backups/checkout-2026-10-29T05-31-28-357Z');
assert.ok(fs.existsSync(path.join(backupDirectory,'verification.json')),'Verified backup required');
const files=[];
function add(full){
  const relative=path.relative(root,full).replaceAll('\\','/');
  if(relative==='test-artifacts/final-baseline-manifest.json')return;
  const data=fs.readFileSync(full);
  files.push({path:relative,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
}
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='uploads'||entry.name==='.git')continue;
  if(entry.name.startsWith('.env')&&!entry.name.endsWith('.example'))continue;
  if(/\.(pem|key|pfx|sql\.bak)$/i.test(entry.name))continue;
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())walk(full);else if(entry.isFile())add(full);
}}
for(const dir of ['backend','frontend','database','docker','gateway'])walk(path.join(root,dir));
for(const file of ['README.md','READINESS-REVIEW.md','.dockerignore'])add(path.join(root,file));
for(const file of fs.readdirSync(__dirname)){
  if(file.startsWith('final-')||['idempotency-browser.png','idempotency-deployment.txt','deploy-checkout.cjs','snapshot-baseline.cjs'].includes(file)){
    const full=path.join(__dirname,file);if(fs.statSync(full).isFile())add(full);
  }
}
files.sort((a,b)=>a.path.localeCompare(b.path));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const images=Object.fromEntries(['webapp_backend','webapp_frontend','webapp_db','webapp_gateway'].map(name=>{
  const item=JSON.parse(docker('inspect',name))[0];
  return [name,{imageId:item.Image,configuredImage:item.Config.Image,health:item.State.Health?.Status}];
}));
const base=JSON.parse(docker('image','inspect','node:24-alpine'))[0];
const verification=JSON.parse(fs.readFileSync(path.join(backupDirectory,'verification.json'),'utf8'));
const manifest={id:'nt120-local-20261029-v1',createdAt:new Date().toISOString(),timezone:'Asia/Saigon',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),
  uncommittedWorkspace:true,scope:'local HTTP baseline with documented accepted limitations',
  backupDirectory,sqlSha256:verification.sqlSha256,images,nodeBaseDigests:base.RepoDigests,
  fileCount:files.length,files};
fs.writeFileSync(path.join(__dirname,'final-baseline-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({id:manifest.id,fileCount:files.length,backupDirectory}));
