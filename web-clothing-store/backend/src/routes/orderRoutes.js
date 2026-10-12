const express = require('express');
const router = express.Router();

const orderController = require('../controllers/orderController');
const {
  requireAuth,
  requireAdmin
} = require('../middlewares/authMiddleware');

// Admin: xem tất cả đơn hàng
router.get(
  '/admin/all',
  requireAuth,
  requireAdmin,
  orderController.getAllOrdersAdmin
);

// Khách hàng: tạo và xem đơn của chính mình
router.post('/', requireAuth, orderController.createOrder);
router.get('/', requireAuth, orderController.getMyOrders);
router.get('/:id', requireAuth, orderController.getOrderDetail);

module.exports = router;