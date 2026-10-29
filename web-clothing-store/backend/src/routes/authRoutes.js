const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { issueCsrfToken } = require('../middlewares/csrfMiddleware');
const { loginRateLimit, registerRateLimit } = require('../middlewares/authRateLimitMiddleware');

router.get('/csrf', issueCsrfToken);
router.post('/register', registerRateLimit, authController.register);
router.post('/login', loginRateLimit, authController.login);

module.exports = router;
