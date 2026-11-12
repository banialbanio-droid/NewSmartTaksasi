const express = require('express');
const router = express.Router();
const targetController = require('../controllers/targetController');
const { requireAuth } = require('../middleware/auth');

// Semua marketing boleh melihat target (supaya saling terpacu).
router.get('/', requireAuth, targetController.listTargets);

// Hanya supervisor yang boleh menulis — dicek di controller.
router.post('/', requireAuth, targetController.simpanTarget);
router.delete('/:csId', requireAuth, targetController.hapusTarget);

module.exports = router;
