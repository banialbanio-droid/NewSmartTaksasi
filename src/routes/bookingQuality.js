const express = require('express');
const router = express.Router();
const bqController = require('../controllers/bqController');
const { requireAuth } = require('../middleware/auth');

router.get('/stats/summary', requireAuth, bqController.getBQStats);
router.get('/', requireAuth, bqController.listBQ);
router.get('/:contractNo', requireAuth, bqController.getBQDetail);
router.put('/:contractNo', requireAuth, bqController.updateBQ);

module.exports = router;
