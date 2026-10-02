const db = require('../config/db');

exports.getCart = async (req, res) => {
  try {
    const query = 'SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.image_url ' +
                  'FROM cart_items ci ' +
                  'JOIN products p ON ci.product_id = p.id ' +
                  'WHERE ci.user_id = ?';
    const [rows] = await db.query(query, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    if (!product_id) return res.status(400).json({ message: 'Missing product_id' });

    const [existing] = await db.query(
      'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.user.id, product_id]
    );

    if (existing.length > 0) {
      const newQty = existing[0].quantity + (quantity || 1);
      await db.query('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQty, existing[0].id]);
    } else {
      await db.query(
        'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)',
        [req.user.id, product_id, quantity || 1]
      );
    }

    res.status(201).json({ message: 'Added to cart' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    const { quantity } = req.body;
    await db.query(
      'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
      [quantity, req.params.id, req.user.id]
    );
    res.json({ message: 'Cart updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.removeCartItem = async (req, res) => {
  try {
    await db.query('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Removed from cart' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};