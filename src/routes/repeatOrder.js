const express = require('express');
const router = express.Router();
const roController = require('../controllers/roController');
const { requireAuth } = require('../middleware/auth');

router.get('/stats/summary', requireAuth, roController.getROStats);
router.get('/', requireAuth, roController.listRO);
router.get('/:contractNo', requireAuth, roController.getRODetail);
router.put('/:contractNo', requireAuth, roController.updateRO);

module.exports = router;
