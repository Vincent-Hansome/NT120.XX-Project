const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { trustedOrigins } = require('../config/trustedOrigins');

const CSRF_TTL_SECONDS = 2 * 60 * 60;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

exports.issueCsrfToken = (req, res) => {
  const expiresAt = Math.floor(Date.now() / 1000) + CSRF_TTL_SECONDS;
  const csrfToken = jwt.sign(
    {
      purpose: 'csrf',
      nonce: crypto.randomBytes(32).toString('base64url')
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: CSRF_TTL_SECONDS }
  );

  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken, expiresAt: expiresAt * 1000 });
};

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return origin;

  const referer = req.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

exports.csrfProtection = (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const origin = requestOrigin(req);
  if (!origin || !trustedOrigins.has(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed' });
  }

  const csrfToken = req.get('x-csrf-token');
  if (!csrfToken) {
    return res.status(403).json({ message: 'CSRF token required' });
  }

  let claims;
  try {
    claims = jwt.verify(csrfToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }

  if (
    !claims ||
    claims.purpose !== 'csrf' ||
    typeof claims.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(claims.nonce)
  ) {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }

  return next();
};
