// Additive and repeatable: does not seed, reset, or alter existing business rows.
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS support_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  subject VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
  admin_reply TEXT NULL,
  replied_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_support_user_id (user_id, id),
  CONSTRAINT fk_support_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function migrate(connection) {
  await connection.query(CREATE_TABLE_SQL);
  // Fail early if an unrelated/incomplete table already uses this name.
  await connection.query('SELECT id, user_id, subject, message, status, admin_reply, replied_at, created_at, updated_at FROM support_tickets LIMIT 0');
}

if (require.main === module) {
  require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
  let db;
  Promise.resolve().then(async () => {
    db = require('../src/config/db');
    await migrate(db);
    console.log('Support tickets migration complete');
  }).catch(error => {
    console.error('Support migration failed:', error.code || 'UNKNOWN');
    process.exitCode = 1;
  }).finally(async () => { if (db) await db.end(); });
}

module.exports = { migrate, CREATE_TABLE_SQL };
