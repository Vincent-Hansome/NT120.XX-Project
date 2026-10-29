const db = require('../config/db');
const { sendDatabaseUnavailable } = require('./databaseAvailability');

class BusinessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Acquire inside the try; a failed BEGIN or rollback must not leak a connection.
async function withTransaction(work) {
  let connection;
  let started = false;
  let destroyed = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    started = true;
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection && started) {
      try {
        await connection.rollback();
      } catch {
        destroyed = true;
        connection.destroy();
      }
    }
    throw error;
  } finally {
    if (connection && !destroyed) connection.release();
  }
}

// Every cart mutation and checkout takes this lock, including an empty cart.
// Product locks are then taken in ascending id order by checkout.
async function lockCart(connection, userId) {
  const [users] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  if (!users.length) throw new BusinessError(401, 'Unauthorized');
}

function sendTransactionError(res, error) {
  if (sendDatabaseUnavailable(res, error)) return true;
  if (error instanceof BusinessError) {
    res.status(error.status).json({ message: error.message });
    return true;
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
    res.status(409).json({ message: 'Data changed during this operation. Please retry.' });
    return true;
  }
  return false;
}

module.exports = { BusinessError, withTransaction, lockCart, sendTransactionError };
