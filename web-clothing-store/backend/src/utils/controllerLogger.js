const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function logControllerError(controller, operation, error) {
  const code = typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code)
    ? error.code
    : 'UNKNOWN';
  const metadata = { code };

  if (Number.isSafeInteger(error?.errno) && error.errno > 0) {
    metadata.errno = error.errno;
  }

  console.error(`[${controller}.${operation}] failed`, metadata);
}

module.exports = { logControllerError };
