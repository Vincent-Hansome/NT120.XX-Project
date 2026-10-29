require('./env');
const mysql = require('mysql2');
const { createBoundedDatabase } = require('./boundedDatabase');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 2000,
  waitForConnections: false,
  connectionLimit: 10,
  queueLimit: 50
});

module.exports = createBoundedDatabase(pool.promise());
