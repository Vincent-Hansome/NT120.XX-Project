const bcrypt = require('bcrypt');
const db = require('../config/db');
const { clearAuthCookie } = require('../config/authCookie');
const {
  isObjectBody,
  validateLoginPassword,
  validateName,
  validateNewPassword
} = require('../utils/authValidation');
const { logControllerError } = require('../utils/controllerLogger');

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    logControllerError('userController', 'getProfile', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  if (!isObjectBody(req.body)) {
    return res.status(400).json({ message: 'Request body must be a JSON object' });
  }

  const allowedFields = new Set(['name', 'currentPassword', 'newPassword']);
  if (Object.keys(req.body).some((field) => !allowedFields.has(field))) {
    return res.status(400).json({ message: 'Unsupported profile field' });
  }

  const hasName = Object.hasOwn(req.body, 'name');
  const hasCurrentPassword = Object.hasOwn(req.body, 'currentPassword');
  const hasNewPassword = Object.hasOwn(req.body, 'newPassword');

  if (!hasName && !hasCurrentPassword && !hasNewPassword) {
    return res.status(400).json({ message: 'No profile changes provided' });
  }

  if (hasName) {
    const nameError = validateName(req.body.name);
    if (nameError) return res.status(400).json({ message: nameError });
  }

  if (hasCurrentPassword !== hasNewPassword) {
    return res.status(400).json({ message: 'Current and new passwords are both required' });
  }

  if (hasCurrentPassword) {
    const currentPasswordError = validateLoginPassword(req.body.currentPassword);
    if (currentPasswordError) return res.status(400).json({ message: currentPasswordError });

    const newPasswordError = validateNewPassword(req.body.newPassword);
    if (newPasswordError) return res.status(400).json({ message: newPasswordError });
  }

  try {
    const values = [];
    const assignments = [];

    if (hasCurrentPassword) {
      const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
      if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

      const matches = await bcrypt.compare(req.body.currentPassword, rows[0].password);
      if (!matches) return res.status(403).json({ message: 'Current password is incorrect' });

      assignments.push('password = ?', 'token_version = token_version + 1');
      values.push(await bcrypt.hash(req.body.newPassword, 10));
    }

    if (hasName) {
      assignments.unshift('name = ?');
      values.unshift(req.body.name.trim());
    }

    values.push(req.user.id);
    const [result] = await db.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values);
    if (hasCurrentPassword && result.affectedRows !== 1) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ message: 'Profile updated' });
  } catch (err) {
    logControllerError('userController', 'updateProfile', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.logout = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE users SET token_version = token_version + 1 WHERE id = ?',
      [req.user.id]
    );
    if (result.affectedRows !== 1) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    clearAuthCookie(res);
    return res.json({ message: 'Logged out' });
  } catch (err) {
    logControllerError('userController', 'logout', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
