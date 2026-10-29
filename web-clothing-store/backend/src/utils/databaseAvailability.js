const UNAVAILABLE = new Set([
  'DB_ACQUIRE_TIMEOUT', 'DB_QUERY_TIMEOUT', 'DB_QUEUE_FULL', 'DB_CONNECTION_CLOSED',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'ER_CON_COUNT_ERROR'
]);
function isDatabaseUnavailable(error) { return UNAVAILABLE.has(error?.code); }
function sendDatabaseUnavailable(res, error) {
  if (!isDatabaseUnavailable(error)) return false;
  res.status(503).json({ message: 'Database service unavailable. Please try again later.' });
  return true;
}
function sendDatabaseError(res, error) {
  if (sendDatabaseUnavailable(res, error)) return;
  return res.status(500).json({ message: 'Server error' });
}
module.exports = { isDatabaseUnavailable, sendDatabaseUnavailable, sendDatabaseError };
