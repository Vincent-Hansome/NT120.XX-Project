async function checkDatabase(pool, logger = console) {
  let exitCode = 0;
  try {
    await pool.query('SELECT 1');
    logger.log('MySQL connection successful');
  } catch {
    logger.error('MySQL connection failed');
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch {
      logger.error('MySQL cleanup failed');
      exitCode = 1;
    }
  }
  return exitCode;
}

if (require.main === module) {
  require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
  Promise.resolve().then(() => checkDatabase(require('./src/config/db')))
    .then(code => { process.exitCode = code; })
    .catch(() => { console.error('Database configuration failed'); process.exitCode = 1; });
}

module.exports = { checkDatabase };
