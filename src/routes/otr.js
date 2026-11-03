const express = require('express');
const router = express.Router();
const otrController = require('../controllers/otrController');
const otrSearchController = require('../controllers/otrSearchController');
const { requireAuth } = require('../middleware/auth');

/**
 * OTR (Harga Pasar) Routes
 * All routes require authentication
 */

// Pencarian bebas multi-kata (semua kolom)
router.get('/search-all', requireAuth, otrSearchController.searchAll);

// Ringkasan jumlah unit / brand / rentang tahun
router.get('/stats', requireAuth, otrSearchController.getStats);

// Autocomplete brand + model
router.get('/suggest', requireAuth, otrSearchController.suggest);

// Search OTR by brand, model, tahun
router.get('/search', requireAuth, otrController.searchOTR);

// Get OTR detail by ID
router.get('/:id', requireAuth, otrController.getOTRDetail);

// Get list of distinct brands
router.get('/brands/list', requireAuth, otrController.getBrands);

// Get models by brand
router.get('/brands/:brand/models', requireAuth, otrController.getModelsByBrand);

module.exports = router;
