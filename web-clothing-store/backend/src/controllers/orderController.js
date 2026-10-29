const { sendDatabaseError } = require('../utils/databaseAvailability');
const db = require('../config/db');
const { logControllerError } = require('../utils/controllerLogger');
const { BusinessError, withTransaction, lockCart, sendTransactionError } = require('../utils/transaction');
const { MAX_TOTAL_CENTS, toCents, toDecimal } = require('../utils/money');

exports.createOrder = async (req, res) => {
  const suppliedKey = req.get('Idempotency-Key');
  if (!suppliedKey) return res.status(428).json({ message: 'Please reload checkout before placing your order.' });
  if (typeof suppliedKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedKey)) {
    return res.status(400).json({ message: 'Checkout request is invalid. Please reload checkout.' });
  }
  const checkoutKey = suppliedKey.toLowerCase();
  try {
    const result = await withTransaction(async connection => {
      await lockCart(connection, req.user.id);
      const [previous] = await connection.query(
        'SELECT id, total FROM orders WHERE user_id = ? AND checkout_key = ?',
        [req.user.id, checkoutKey]
      );
      if (previous.length) return { orderId: previous[0].id, total: String(previous[0].total) };
      const [cartItems] = await connection.query(
        'SELECT id, product_id, quantity FROM cart_items WHERE user_id = ? ORDER BY product_id FOR UPDATE',
        [req.user.id]
      );
      if (!cartItems.length) throw new BusinessError(400, 'Cart is empty');

      let totalCents = 0n;
      for (const item of cartItems) {
        const [products] = await connection.query(
          'SELECT id, price, stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]
        );
        if (!products.length || products[0].stock < item.quantity) {
          throw new BusinessError(409, 'Insufficient stock for product ' + item.product_id);
        }
        item.price = products[0].price;
        totalCents += toCents(item.price) * BigInt(item.quantity);
      }
      if (totalCents > MAX_TOTAL_CENTS) {
        throw new BusinessError(422, 'Order total exceeds the maximum of 99999999.99. Please reduce your cart.');
      }
      const total = toDecimal(totalCents);
      const [order] = await connection.query(
        'INSERT INTO orders (user_id, total, status, checkout_key) VALUES (?, ?, ?, ?)',
        [req.user.id, total, 'pending', checkoutKey]
      );
      for (const item of cartItems) {
        await connection.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
          [order.insertId, item.product_id, item.quantity, item.price]
        );
        const [updated] = await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
          [item.quantity, item.product_id, item.quantity]
        );
        if (updated.affectedRows !== 1) {
          throw new BusinessError(409, 'Insufficient stock for product ' + item.product_id);
        }
      }
      await connection.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
      return { orderId: order.insertId, total };
    });
    return res.status(201).json({ message: 'Order created', ...result });
  } catch (error) {
    if (sendTransactionError(res, error)) return;
    logControllerError('orderController', 'createOrder', error);
    return sendDatabaseError(res, error);
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(orders);
  } catch (err) {
    logControllerError('orderController', 'getMyOrders', err);
    sendDatabaseError(res, err);
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
    logControllerError('orderController', 'getOrderDetail', err);
    sendDatabaseError(res, err);
  }
};

exports.getAllOrdersAdmin = async (req, res) => {
  try {
    const [orders] = await db.query(`
      SELECT
        o.id,
        o.user_id,
        u.name AS customer_name,
        u.email AS customer_email,
        o.total,
        o.status,
        o.created_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC
      LIMIT 500
    `);

    res.json(orders);
  } catch (err) {
    logControllerError('orderController', 'getAllOrdersAdmin', err);
    sendDatabaseError(res, err);
  }
};
