const bcrypt = require('bcrypt');
const db = require('../config/db');

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, password } = req.body;

    if (name) {
      await db.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
    }

    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
};
