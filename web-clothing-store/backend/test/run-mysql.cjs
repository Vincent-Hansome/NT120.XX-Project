const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', '--test-timeout=30000', path.join(__dirname, 'mysql.test.js')], {
  stdio: 'inherit', env: { ...process.env, RUN_MYSQL_TESTS: '1' }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
