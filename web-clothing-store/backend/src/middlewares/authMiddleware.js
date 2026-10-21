const jwt = require('jsonwebtoken');
const db = require('../config/db');

exports.requireAuth = async (req, res, next) => {
  const token = req.cookies?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !Number.isSafeInteger(decoded.id) ||
    decoded.id <= 0 ||
    !Number.isSafeInteger(decoded.tokenVersion) ||
    decoded.tokenVersion < 0 ||
    !Number.isSafeInteger(decoded.exp) ||
    decoded.exp <= Math.floor(Date.now() / 1000)
  ) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  let rows;
  try {
    [rows] = await db.query('SELECT id, role, token_version FROM users WHERE id = ?', [decoded.id]);
  } catch {
    return res.status(503).json({ message: 'Authentication service unavailable' });
  }

  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !Number.isSafeInteger(rows[0].token_version) ||
    rows[0].token_version < 0 ||
    decoded.tokenVersion !== rows[0].token_version
  ) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  req.user = { id: rows[0].id, role: rows[0].role };
  return next();
};

exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
};
