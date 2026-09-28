const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rateLimit = require('../middlewares/rateLimit.middleware');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// Rotas públicas (com limite de tentativas)
router.post('/register', authLimiter, userController.register);
router.post('/login', authLimiter, userController.login);

// Rotas protegidas (Exigem JWT)
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.put('/password', authMiddleware, userController.changePassword);

module.exports = router;
