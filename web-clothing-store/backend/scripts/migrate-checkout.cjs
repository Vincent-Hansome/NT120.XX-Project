// Additive migration: old orders keep NULL keys; only new checkout intents use keys.
async function migrate(connection) {
  const [columns] = await connection.query("SHOW FULL COLUMNS FROM orders LIKE 'checkout_key'");
  if (!columns.length) {
    await connection.query('ALTER TABLE orders ADD COLUMN checkout_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL');
  } else if (columns[0].Type.toLowerCase() !== 'char(36)' || columns[0].Collation !== 'ascii_bin' || columns[0].Null !== 'YES') {
    throw new Error('Existing checkout_key column is incompatible; manual review required');
  }
  const [indexes] = await connection.query('SHOW INDEX FROM orders');
  const groups = new Map();
  for (const index of indexes) {
    if (!groups.has(index.Key_name)) groups.set(index.Key_name, []);
    groups.get(index.Key_name).push(index);
  }
  const matching = [...groups.values()].some(parts => {
    parts.sort((a, b) => a.Seq_in_index - b.Seq_in_index);
    return parts.length === 2 && parts.every(p => Number(p.Non_unique) === 0 && p.Sub_part == null) &&
      parts[0].Column_name === 'user_id' && parts[1].Column_name === 'checkout_key';
  });
  if (!matching) {
    if (groups.has('uq_orders_checkout')) throw new Error('Conflicting index name uq_orders_checkout');
    await connection.query('ALTER TABLE orders ADD UNIQUE KEY uq_orders_checkout (user_id, checkout_key)');
  }
}

if (require.main === module) {
  require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
  let db;
  Promise.resolve().then(async () => {
    db = require('../src/config/db');
    await migrate(db);
    console.log('Checkout idempotency migration complete');
  }).catch(error => {
    console.error('Migration failed:', error.code || error.message);
    process.exitCode = 1;
  }).finally(async () => { if (db) await db.end(); });
}
module.exports = { migrate };
