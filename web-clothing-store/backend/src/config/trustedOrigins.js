const DEVELOPMENT_ORIGIN = 'http://localhost:3000';

function parseTrustedOrigins(value = process.env.CSRF_TRUSTED_ORIGINS, environment = process.env.NODE_ENV) {
  if (!value || !value.trim()) {
    if (environment === 'production') {
      throw new Error('CSRF_TRUSTED_ORIGINS must be configured in production.');
    }
    return new Set([DEVELOPMENT_ORIGIN]);
  }

  const origins = value.split(',').map((origin) => origin.trim());
  if (origins.some((origin) => !origin)) {
    throw new Error('CSRF_TRUSTED_ORIGINS must contain valid origins.');
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CSRF_TRUSTED_ORIGINS must contain valid origins.');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      (environment === 'production' && parsed.protocol !== 'https:')
    ) {
      throw new Error('CSRF_TRUSTED_ORIGINS must be exact HTTPS origins in production.');
    }
  }

  return new Set(origins);
}

const trustedOrigins = parseTrustedOrigins();

module.exports = { DEVELOPMENT_ORIGIN, parseTrustedOrigins, trustedOrigins };
