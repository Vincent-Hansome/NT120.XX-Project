const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath,['--test','--test-timeout=60000',path.join(__dirname,'category-migration.test.js')],{
  stdio:'inherit',env:{...process.env,RUN_CATEGORY_MYSQL_TESTS:'1'},windowsHide:true
});
if(result.error) throw result.error;
process.exitCode=result.status??1;
