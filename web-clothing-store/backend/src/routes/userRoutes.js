const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.get('/me', requireAuth, userController.getProfile);
router.put('/me', requireAuth, userController.updateProfile);
router.post('/logout', requireAuth, userController.logout);

module.exports = router;
