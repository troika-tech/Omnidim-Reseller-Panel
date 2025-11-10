const express = require('express');
const auth = require('../middleware/auth.js');
const {
  login,
  register,
  getMe
} = require('../controllers/authController.js');

const router = express.Router();

// Public routes (no auth required)
router.post('/login', login);
router.post('/register', register);

// Protected routes (require auth)
router.get('/me', auth, getMe);

module.exports = router;

