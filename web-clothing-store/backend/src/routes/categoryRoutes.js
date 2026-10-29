const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');
const { validateIdParam } = require('../middlewares/idValidationMiddleware');

router.get('/', categoryController.getAll);
router.post('/', requireAuth, requireAdmin, categoryController.create);
router.put('/:id', requireAuth, requireAdmin, validateIdParam, categoryController.update);
router.delete('/:id', requireAuth, requireAdmin, validateIdParam, categoryController.remove);

module.exports = router;
