// Read-only operational inventory. Never print names, rows, credentials or grants.
const db = require('../src/config/db');
(async () => {
  const [[identity]] = await db.query(`SELECT DATABASE() AS db, @@hostname AS hostname,
    @@server_uuid AS server_uuid, @@version AS version, @@collation_database AS collation_db,
    CURRENT_USER() AS account, @@global.read_only AS readOnly`);
  const [columns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLLATION_NAME
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('categories','products')`);
  const [indexes] = await db.query(`SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
  const [foreignKeys] = await db.query(`SELECT k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,
    k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE()`);
  const [possibleReferences] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND (COLUMN_NAME LIKE '%category%' OR COLUMN_NAME LIKE '%categorie%')`);
  const [tables] = await db.query(`SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'`);
  const counts = {};
  for (const t of tables) {
    const [[row]] = await db.query('SELECT COUNT(*) AS n FROM ??', [t.TABLE_NAME]);
    counts[t.TABLE_NAME] = row.n;
  }
  const [duplicates] = await db.query(`SELECT MIN(id) AS keep_id, GROUP_CONCAT(id ORDER BY id) AS ids,
    COUNT(*) AS n FROM categories GROUP BY name HAVING COUNT(*)>1`);
  const [links] = await db.query('SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id');
  const [[orphans]] = await db.query(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c
    ON c.id=p.category_id WHERE p.category_id IS NOT NULL AND c.id IS NULL`);
  console.log(JSON.stringify({ host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    identity, tables, columns, indexes, foreignKeys, possibleReferences, counts, duplicates, links, orphans }, null, 2));
})().catch(error => { console.error(JSON.stringify({error: error.code || error.name})); process.exitCode=1; })
  .finally(() => db.end());
