const express = require('express');
const router = express.Router();
const pricelistController = require('../controllers/pricelistController');
const { requireAuth } = require('../middleware/auth');

router.get('/info', requireAuth, pricelistController.infoPriceList);
router.get('/', requireAuth, pricelistController.cariPriceList);

module.exports = router;
