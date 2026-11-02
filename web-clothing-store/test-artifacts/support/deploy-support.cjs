// Local additive deployment. Only run with --apply after verification passes.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const docker = (...args) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024 }).trim();
const compose = (...args) => docker('compose', '--env-file', 'docker/.env', '-f', 'docker/docker-compose.yml', ...args);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function sql(query) {
  return docker('exec', 'webapp_db', 'sh', '-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --default-character-set=utf8mb4 --user=root --batch --raw --skip-column-names "$MYSQL_DATABASE" --execute="$1"', 'sh', query);
}
function snapshot() {
  const result = {};
  for (const table of ['users', 'categories', 'products', 'cart_items', 'orders', 'order_items']) {
    const columns = sql(`SHOW COLUMNS FROM ${table}`).split('\n').map(row => row.split('\t')[0]);
    for (const column of columns) assert.match(column, /^[a-z_]+$/);
    const fields = columns.map(column => `'${column}',\`${column}\``).join(',');
    const rows = sql(`SELECT JSON_OBJECT(${fields}) FROM ${table} ORDER BY id`);
    result[table] = { count: rows ? rows.split('\n').length : 0, sha256: hash(rows) };
  }
  return result;
}
async function main() {
  assert.ok(process.argv.includes('--apply'), 'Pass --apply to update the local stack');
  const before = snapshot();
  const oldImages = {};
  for (const name of ['webapp_backend', 'webapp_frontend']) {
    oldImages[name] = docker('inspect', '--format', '{{.Image}}', name);
  }
  fs.writeFileSync(path.join(__dirname, 'deployment-before.json'), JSON.stringify({ before, oldImages }, null, 2));
  console.log('Recorded previous image IDs and business-row hashes. Building backend and frontend.');
  console.log(compose('build', 'backend', 'frontend'));
  console.log(compose('run', '--rm', '--no-deps', 'backend', 'node', 'scripts/migrate-support.cjs'));
  assert.deepEqual(snapshot(), before, 'Existing business rows changed during the additive migration');
  console.log('Support table created; hashes of all existing business tables match.');
  console.log(compose('up', '-d', '--no-deps', 'backend', 'frontend'));
  // The gateway resolves the recreated frontend address through Docker DNS.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://localhost:3000/support', { signal: AbortSignal.timeout(2500) });
      if (response.status === 200 && (await response.text()).includes('data-support-customer')) break;
    } catch {}
    if (attempt === 59) throw new Error('Updated storefront did not become ready');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const checks = {};
  for (const route of ['/support', '/admin/support', '/js/support.js', '/css/support.css']) {
    const response = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, route);
    checks[route] = response.status;
  }
  const response = await fetch('http://localhost:3000/api/support/tickets');
  assert.equal(response.status, 401);
  checks['/api/support/tickets (anonymous)'] = response.status;
  const after = snapshot();
  assert.deepEqual(after, before, 'Existing business rows changed during deployment');
  const report = { date: '2026-11-02', before, after, checks,
    supportTableExists: sql("SHOW TABLES LIKE 'support_tickets'") === 'support_tickets' };
  assert.equal(report.supportTableExists, true);
  fs.writeFileSync(path.join(__dirname, 'deployment-verification.json'), JSON.stringify(report, null, 2));
  console.log('Local support deployment verified; existing business rows are unchanged.');
  console.log(compose('ps'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
