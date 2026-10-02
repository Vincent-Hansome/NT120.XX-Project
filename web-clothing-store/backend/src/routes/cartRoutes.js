const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.get('/', requireAuth, cartController.getCart);
router.post('/', requireAuth, cartController.addToCart);
router.put('/:id', requireAuth, cartController.updateCartItem);
router.delete('/:id', requireAuth, cartController.removeCartItem);

module.exports = router;
