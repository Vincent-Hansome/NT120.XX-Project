const { sendDatabaseError } = require('../utils/databaseAvailability');
﻿const db = require('../config/db');

const { logControllerError } = require('../utils/controllerLogger');
const { BusinessError, withTransaction, lockCart, sendTransactionError } = require('../utils/transaction');

const MAX_SQL_INT = 2_147_483_647;

function parsePositiveInt(value) {
  if (
    !(typeof value === 'number' && Number.isSafeInteger(value)) &&
    !(typeof value === 'string' && /^[1-9]\d*$/.test(value))
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_SQL_INT
    ? parsed
    : null;
}

exports.getCart = async (req, res) => {
  try {
    const query = 'SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.image_url ' +
                  'FROM cart_items ci ' +
                  'JOIN products p ON ci.product_id = p.id ' +
                  'WHERE ci.user_id = ?';
    const [rows] = await db.query(query, [req.user.id]);
    res.json(rows);
  } catch (err) {
    logControllerError('cartController', 'getCart', err);
    sendDatabaseError(res, err);
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { product_id, quantity = 1 } = req.body || {};
    const productId = parsePositiveInt(product_id);
    const qty = parsePositiveInt(quantity);

    if (productId === null) {
      return res.status(400).json({ message: 'Invalid product_id' });
    }

    if (qty === null) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    await withTransaction(async connection => {
      await lockCart(connection, req.user.id);
      const [products] = await connection.query(
        'SELECT id, stock FROM products WHERE id = ? FOR UPDATE',
        [productId]
      );

      if (products.length === 0) {
        throw new BusinessError(404, 'Product not found');
      }

      const product = products[0];

      const [existing] = await connection.query(
        'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?',
        [req.user.id, productId]
      );

      const newQty = existing.length > 0
        ? existing[0].quantity + qty
        : qty;

      if (newQty > product.stock || newQty > MAX_SQL_INT) {
        throw new BusinessError(409, 'Quantity exceeds stock');
      }

      if (existing.length > 0) {
        await connection.query(
          'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
          [newQty, existing[0].id, req.user.id]
        );
      } else {
        await connection.query(
          'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)',
          [req.user.id, productId, qty]
        );
      }

    });
    res.status(201).json({ message: 'Added to cart' });
  } catch (err) {
    if (sendTransactionError(res, err)) return;

    logControllerError('cartController', 'addToCart', err);
    sendDatabaseError(res, err);
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    const quantity = parsePositiveInt(req.body?.quantity);
    const itemId = parsePositiveInt(req.params.id);

    if (itemId === null || quantity === null) {
      return res.status(400).json({
        message: 'Invalid cart item or quantity'
      });
    }

    await withTransaction(async connection => {
      await lockCart(connection, req.user.id);
      const [items] = await connection.query(
        'SELECT id, product_id FROM cart_items WHERE id = ? AND user_id = ? FOR UPDATE',
        [itemId, req.user.id]
      );

      if (items.length === 0) {
        throw new BusinessError(404, 'Cart item not found');
      }

      const [products] = await connection.query(
        'SELECT id, stock FROM products WHERE id = ? FOR UPDATE', [items[0].product_id]
      );
      if (!products.length) throw new BusinessError(404, 'Product not found');
      if (quantity > products[0].stock) {
        throw new BusinessError(409, 'Quantity exceeds stock');
      }

      await connection.query(
        'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
        [quantity, itemId, req.user.id]
      );

    });
    res.json({ message: 'Cart updated' });
  } catch (err) {
    if (sendTransactionError(res, err)) return;
    logControllerError('cartController', 'updateCartItem', err);
    sendDatabaseError(res, err);
  }
};

exports.removeCartItem = async (req, res) => {
  try {
    await withTransaction(async connection => {
      await lockCart(connection, req.user.id);
      const [result] = await connection.query(
        'DELETE FROM cart_items WHERE id = ? AND user_id = ?',
        [req.params.id, req.user.id]
      );
      if (result.affectedRows === 0) {
        throw new BusinessError(404, 'Cart item not found');
      }

    });
    res.json({ message: 'Removed from cart' });
  } catch (err) {
    if (sendTransactionError(res, err)) return;
    logControllerError('cartController', 'removeCartItem', err);
    sendDatabaseError(res, err);
  }
};
