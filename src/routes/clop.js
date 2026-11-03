const express = require('express');
const router = express.Router();
const clopController = require('../controllers/clopController');
const { requireAuth } = require('../middleware/auth');

router.get('/stats', requireAuth, clopController.getClopStats);
router.get('/search', requireAuth, clopController.searchClop);
router.get('/check/:contractNo', requireAuth, clopController.checkClop);

module.exports = router;
