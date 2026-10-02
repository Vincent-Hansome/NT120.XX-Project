const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

router.get('/', categoryController.getAll);
router.post('/', requireAuth, requireAdmin, categoryController.create);
router.put('/:id', requireAuth, requireAdmin, categoryController.update);
router.delete('/:id', requireAuth, requireAdmin, categoryController.remove);

module.exports = router;
