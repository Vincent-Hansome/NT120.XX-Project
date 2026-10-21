const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

const AUTH_RATE_LIMITS = Object.freeze({
  login: Object.freeze({ windowMs: 15 * 60 * 1000, max: 10 }),
  register: Object.freeze({ windowMs: 15 * 60 * 1000, max: 30 })
});

const MAX_BUCKETS = 10000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const FRONTEND_SERVICE_HOST = process.env.FRONTEND_SERVICE_HOST || 'frontend';

function normalizeIpAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);

  if (mappedIpv4 && net.isIP(mappedIpv4[1]) === 4) return mappedIpv4[1];
  if (net.isIP(address) === 4) return address;
  if (net.isIP(address) === 6) return address.toLowerCase();
  return null;
}

function createFrontendAddressResolver({
  host = FRONTEND_SERVICE_HOST,
  lookup = dns.lookup,
  ttlMs = 30 * 1000,
  failureTtlMs = 5 * 1000
} = {}) {
  let cachedUntil = 0;
  let cachedAddresses = new Set();
  let pendingLookup;

  return async function resolveFrontendAddresses() {
    if (Date.now() < cachedUntil) return cachedAddresses;
    if (pendingLookup) return pendingLookup;

    pendingLookup = (async () => {
      try {
        const records = await lookup(host, { all: true, verbatim: true });
        cachedAddresses = new Set(
          records.map((record) => normalizeIpAddress(record.address)).filter(Boolean)
        );
        cachedUntil = Date.now() + (cachedAddresses.size ? ttlMs : failureTtlMs);
      } catch {
        cachedAddresses = new Set();
        cachedUntil = Date.now() + failureTtlMs;
      }

      return cachedAddresses;
    })();

    try {
      return await pendingLookup;
    } finally {
      pendingLookup = undefined;
    }
  };
}

const resolveFrontendAddresses = createFrontendAddressResolver();

function requestHeader(req, name) {
  if (typeof req.get === 'function') return req.get(name);
  return req.headers?.[name.toLowerCase()];
}

async function resolveClientIp(req, getFrontendAddresses = resolveFrontendAddresses) {
  const socketAddress = req.socket?.remoteAddress;
  const socketIp = normalizeIpAddress(socketAddress);
  const fallbackIp = socketIp || socketAddress || 'unknown';
  if (!socketIp) return fallbackIp;

  let frontendAddresses;
  try {
    frontendAddresses = await getFrontendAddresses();
  } catch {
    return fallbackIp;
  }

  if (!frontendAddresses?.has(socketIp)) return fallbackIp;

  const forwardedIp = normalizeIpAddress(requestHeader(req, 'x-forwarded-for'));
  const realIp = normalizeIpAddress(requestHeader(req, 'x-real-ip'));
  if (forwardedIp && forwardedIp === realIp) return forwardedIp;

  return fallbackIp;
}

function createRateLimiter({ windowMs, max, keyForRequest, countOnlyStatus }) {
  const buckets = new Map();
  let cleanupAt = 0;

  function removeExpired(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function applyRateLimit(req, res, next, identityOverride) {
    const now = Date.now();
    if (now >= cleanupAt) {
      removeExpired(now);
      cleanupAt = now + CLEANUP_INTERVAL_MS;
    }

    const identity = String(identityOverride === undefined ? keyForRequest(req) : identityOverride);
    const bucketKey = crypto.createHash('sha256').update(identity).digest('hex');
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }

    if (bucket.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    bucket.count += 1;
    buckets.delete(bucketKey);
    buckets.set(bucketKey, bucket);

    if (buckets.size > MAX_BUCKETS) {
      removeExpired(now);
      while (buckets.size > MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value);
      }
    }

    if (countOnlyStatus !== undefined) {
      res.once('finish', () => {
        if (res.statusCode === countOnlyStatus) return;
        const current = buckets.get(bucketKey);
        if (current !== bucket) return;
        current.count = Math.max(0, current.count - 1);
        if (current.count === 0) buckets.delete(bucketKey);
      });
    }

    return next();
  }

  const middleware = (req, res, next) => applyRateLimit(req, res, next);
  middleware.withIdentity = (req, res, next, identity) => applyRateLimit(req, res, next, identity);
  return middleware;
}

function createLoginRateLimit({
  resolveClientIp: clientIpResolver = resolveClientIp,
  windowMs = AUTH_RATE_LIMITS.login.windowMs,
  max = AUTH_RATE_LIMITS.login.max
} = {}) {
  const limiter = createRateLimiter({
    windowMs,
    max,
    keyForRequest(req) {
      return `login:${req.socket?.remoteAddress || 'unknown'}`;
    },
    countOnlyStatus: 401
  });

  return async function loginRateLimit(req, res, next) {
    const clientIp = await clientIpResolver(req);
    return limiter.withIdentity(req, res, next, `login:${clientIp}`);
  };
}

const loginRateLimit = createLoginRateLimit();

const registerLimiter = createRateLimiter({
  ...AUTH_RATE_LIMITS.register,
  keyForRequest(req) {
    return `register:${req.socket?.remoteAddress || 'unknown'}`;
  }
});

async function registerRateLimit(req, res, next) {
  const clientIp = await resolveClientIp(req);
  return registerLimiter.withIdentity(req, res, next, `register:${clientIp}`);
}

module.exports = {
  AUTH_RATE_LIMITS,
  createFrontendAddressResolver,
  createLoginRateLimit,
  loginRateLimit,
  normalizeIpAddress,
  registerRateLimit,
  resolveClientIp
};
