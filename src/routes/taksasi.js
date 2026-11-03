const express = require('express');
const router = express.Router();
const taksasiController = require('../controllers/taksasiController');
const { requireAuth } = require('../middleware/auth');

// Config & referensi (tidak butuh perhitungan)
router.get('/config', requireAuth, taksasiController.config);
router.get('/tenor-options', requireAuth, taksasiController.tenorOptions);
router.get('/angsuran', requireAuth, taksasiController.angsuran);
router.get('/persen-taksasi', requireAuth, taksasiController.persenTaksasi);

// Perhitungan
router.post('/hitung', requireAuth, taksasiController.hitung);
router.post('/bandingkan-tenor', requireAuth, taksasiController.bandingkan);
router.post('/simpan', requireAuth, taksasiController.simpan);
router.get('/riwayat', requireAuth, taksasiController.riwayat);

module.exports = router;
