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
    const { product_id, quantity = 1 } = req.body;

    if (!Number.isInteger(Number(product_id))) {
      return res.status(400).json({ message: 'Invalid product_id' });
    }

    if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    const productId = Number(product_id);
    const qty = Number(quantity);

    const [products] = await db.query(
      'SELECT id, stock FROM products WHERE id = ?',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = products[0];

    const [existing] = await db.query(
      'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );

    const newQty = existing.length > 0
      ? existing[0].quantity + qty
      : qty;

    if (newQty > product.stock) {
      return res.status(400).json({
        message: 'Quantity exceeds stock'
      });
    }

    if (existing.length > 0) {
      await db.query(
        'UPDATE cart_items SET quantity = ? WHERE id = ?',
        [newQty, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)',
        [req.user.id, productId, qty]
      );
    }

    res.status(201).json({ message: 'Added to cart' });
  } catch (err) {
    console.error(err);

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Product already exists in cart'
      });
    }

    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    const quantity = Number(req.body.quantity);
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: 'Invalid cart item or quantity'
      });
    }

    const [items] = await db.query(
      `SELECT ci.id, p.stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.id = ? AND ci.user_id = ?`,
      [itemId, req.user.id]
    );

    if (items.length === 0) {
      return res.status(404).json({
        message: 'Cart item not found'
      });
    }

    if (quantity > items[0].stock) {
      return res.status(400).json({
        message: 'Quantity exceeds stock'
      });
    }

    await db.query(
      'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
      [quantity, itemId, req.user.id]
    );

    res.json({ message: 'Cart updated' });
  } catch (err) {
    console.error(err);
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