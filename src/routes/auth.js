const express = require('express');
const router = express.Router();
const { login, validateSession, logout, changePin } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth'); // NEW

// Public routes
router.post('/login', login);

// Protected routes (PIN-based auth - for fallback/admin)
router.get('/validate', requireAuth, validateSession);
router.post('/logout', requireAuth, logout);
router.post('/change-pin', requireAuth, changePin);

// Firebase Auth session route (SPA expects POST /api/auth/session)
router.post('/session', requireFirebaseAuth, (req, res) => {
  // req.user is set by requireFirebaseAuth middleware
  res.json({ success: true, user: req.user });
});

module.exports = router;
