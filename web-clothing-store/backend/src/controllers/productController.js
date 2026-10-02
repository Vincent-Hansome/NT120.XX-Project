const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price, stock, size, color } = req.body;
    const category_id = req.body.category_id ? req.body.category_id : null;
    const image_url = req.file ? '/uploads/' + req.file.filename : null;

    const [result] = await db.query(
      'INSERT INTO products (name, description, price, stock, size, color, image_url, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, price, stock, size, color, image_url, category_id]
    );
    res.status(201).json({ message: 'Product created', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, price, stock, size, color, category_id } = req.body;
    const fields = [name, description, price, stock, size, color, category_id];
    let query = 'UPDATE products SET name=?, description=?, price=?, stock=?, size=?, color=?, category_id=?';

    if (req.file) {
      query += ', image_url=?';
      fields.push('/uploads/' + req.file.filename);
    }
    query += ' WHERE id=?';
    fields.push(req.params.id);

    await db.query(query, fields);
    res.json({ message: 'Product updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};
