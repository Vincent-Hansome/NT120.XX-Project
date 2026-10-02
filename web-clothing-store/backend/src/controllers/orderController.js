const db = require('../config/db');

exports.createOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const cartQuery = 'SELECT ci.product_id, ci.quantity, p.price, p.stock ' +
                       'FROM cart_items ci ' +
                       'JOIN products p ON ci.product_id = p.id ' +
                       'WHERE ci.user_id = ?';
    const [cartItems] = await connection.query(cartQuery, [req.user.id]);

    if (cartItems.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Cart is empty' });
    }

    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({ message: 'Insufficient stock for product ' + item.product_id });
      }
    }

    const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const [orderResult] = await connection.query(
      'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)',
      [req.user.id, total, 'pending']
    );
    const orderId = orderResult.insertId;

    for (const item of cartItems) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price]
      );
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    await connection.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);

    await connection.commit();
    res.status(201).json({ message: 'Order created', orderId, total });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    connection.release();
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getOrderDetail = async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });

    const itemsQuery = 'SELECT oi.*, p.name, p.image_url ' +
                        'FROM order_items oi ' +
                        'JOIN products p ON oi.product_id = p.id ' +
                        'WHERE oi.order_id = ?';
    const [items] = await db.query(itemsQuery, [req.params.id]);

    res.json({ order: orders[0], items });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};