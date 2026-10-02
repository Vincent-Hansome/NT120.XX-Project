const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/', requireAuth, orderController.createOrder);
router.get('/', requireAuth, orderController.getMyOrders);
router.get('/:id', requireAuth, orderController.getOrderDetail);

module.exports = router;
