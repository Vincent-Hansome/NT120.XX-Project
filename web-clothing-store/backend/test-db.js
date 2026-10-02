const pool = require('./src/config/db');

async function test() {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    console.log('✅ Kết nối MySQL thành công:', rows);
  } catch (err) {
    console.error('❌ Lỗi kết nối:', err.message);
  }
  process.exit();
}

test();