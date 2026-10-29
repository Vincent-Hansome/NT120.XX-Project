function databaseError(code) { return Object.assign(new Error(code), { code }); }

// Own the queue so expired waiters are removed before acquiring a socket.
function createBoundedDatabase(pool, {
  connectionLimit = 10, queueLimit = 50, acquireTimeoutMs = 1000, queryTimeoutMs = 3000
} = {}) {
  let active = 0;
  let closed = false;
  const queue = [];
  function pump() {
    while (!closed && active < connectionLimit && queue.length) queue.shift().start();
  }
  function getConnection() {
    if (closed) return Promise.reject(databaseError('DB_CONNECTION_CLOSED'));
    if (active >= connectionLimit && queue.length >= queueLimit) {
      return Promise.reject(databaseError('DB_QUEUE_FULL'));
    }
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        reject(databaseError('DB_ACQUIRE_TIMEOUT'));
      }, acquireTimeoutMs);
      const waiter = { cancel() {
        clearTimeout(timer);
        expired = true;
        reject(databaseError('DB_CONNECTION_CLOSED'));
      }, start() {
        active++;
        let returned = false;
        const releaseSlot = () => {
          if (returned) return;
          returned = true;
          active--;
          pump();
        };
        Promise.resolve().then(() => pool.getConnection()).then(connection => {
          clearTimeout(timer);
          if (expired || closed) {
            connection.destroy();
            releaseSlot();
            if (!expired) reject(databaseError('DB_CONNECTION_CLOSED'));
            return;
          }
          let disposed = false;
          function destroy() {
            if (disposed) return;
            disposed = true;
            try { connection.destroy(); } finally { releaseSlot(); }
          }
          function release() {
            if (disposed) return;
            disposed = true;
            try { connection.release(); } finally { releaseSlot(); }
          }
          async function operation(method, args, timeoutMs = queryTimeoutMs) {
            if (disposed) throw databaseError('DB_CONNECTION_CLOSED');
            let timeout;
            try {
              return await Promise.race([
                Promise.resolve().then(() => connection[method](...args)),
                new Promise((_, fail) => {
                  timeout = setTimeout(() => {
                    // A timed-out socket must never be reused for another request.
                    destroy();
                    fail(databaseError('DB_QUERY_TIMEOUT'));
                  }, timeoutMs);
                })
              ]);
            } finally { clearTimeout(timeout); }
          }
          resolve({
            query: (...args) => operation('query', args),
            execute: (...args) => operation('execute', args),
            beginTransaction: () => operation('beginTransaction', []),
            commit: () => operation('commit', []),
            rollback: () => operation('rollback', []),
            queryWithTimeout: (sql, values, ms) => operation('query', [sql, values], ms),
            release, destroy
          });
        }, error => {
          clearTimeout(timer);
          releaseSlot();
          if (!expired) reject(error);
        });
      } };
      if (active < connectionLimit) waiter.start(); else queue.push(waiter);
    });
  }
  async function withConnection(method, args) {
    const connection = await getConnection();
    try { return await connection[method](...args); } finally { connection.release(); }
  }
  return {
    getConnection,
    query: (...args) => withConnection('query', args),
    execute: (...args) => withConnection('execute', args),
    queryWithTimeout: (...args) => withConnection('queryWithTimeout', args),
    async end() {
      closed = true;
      for (const waiter of queue.splice(0)) waiter.cancel();
      await pool.end();
    }
  };
}
module.exports = { createBoundedDatabase };
