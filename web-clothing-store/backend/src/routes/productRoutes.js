const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.get('/', productController.getAll);
router.get('/:id', productController.getById);
router.post('/', requireAuth, requireAdmin, upload.single('image'), productController.create);
router.put('/:id', requireAuth, requireAdmin, upload.single('image'), productController.update);
router.delete('/:id', requireAuth, requireAdmin, productController.remove);

module.exports = router;
