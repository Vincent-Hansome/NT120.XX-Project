const { sendDatabaseError } = require('../utils/databaseAvailability');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { AUTH_COOKIE_NAME, JWT_TTL_SECONDS, authCookieOptions } = require('../config/authCookie');
const {
  isObjectBody,
  normalizeEmail,
  validateEmail,
  validateLoginPassword,
  validateName,
  validateNewPassword
} = require('../utils/authValidation');
const { logControllerError } = require('../utils/controllerLogger');

exports.register = async (req, res) => {
  if (!isObjectBody(req.body)) {
    return res.status(400).json({ message: 'Request body must be a JSON object' });
  }

  const { name, email, password } = req.body;
  const nameError = validateName(name);
  if (nameError) return res.status(400).json({ message: nameError });

  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ message: emailError });

  const passwordError = validateNewPassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const normalizedName = name.trim();
  const normalizedEmail = normalizeEmail(email);

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [normalizedName, normalizedEmail, hashed]
    );
    return res.status(201).json({ message: 'Registered successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Account already exists'
      });
    }

    logControllerError('authController', 'register', err);
    return sendDatabaseError(res, err);
  }
};

exports.login = async (req, res) => {
  if (!isObjectBody(req.body)) {
    return res.status(400).json({ message: 'Request body must be a JSON object' });
  }

  const { email, password } = req.body;
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ message: emailError });

  const passwordError = validateLoginPassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, password, token_version FROM users WHERE email = ?',
      [normalizeEmail(email)]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, tokenVersion: user.token_version },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: JWT_TTL_SECONDS }
    );

    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    return res.json({ message: 'Logged in', user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    logControllerError('authController', 'login', err);
    return sendDatabaseError(res, err);
  }
};
