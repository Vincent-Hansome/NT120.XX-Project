const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { validateIdParam } = require('../middlewares/idValidationMiddleware');

router.get('/', requireAuth, cartController.getCart);
router.post('/', requireAuth, cartController.addToCart);
router.put('/:id', requireAuth, validateIdParam, cartController.updateCartItem);
router.delete('/:id', requireAuth, validateIdParam, cartController.removeCartItem);

module.exports = router;
