const express = require('express');
const router = express.Router();
const multer = require('multer');
const masterImportController = require('../controllers/masterImportController');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

// Simpan di memori: file langsung diproses, tidak menumpuk di disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (!ok) {
      return cb(new Error('Format file harus .xlsx, .xls, atau .csv'));
    }
    cb(null, true);
  },
});

router.get('/types', requireAuth, masterImportController.getTypes);
router.get('/summary', requireAuth, masterImportController.getSummary);
router.get('/history', requireAuth, masterImportController.getHistory);
// Hanya supervisor yang boleh mengubah data master.
router.post('/import', requireAuth, requireSupervisor, upload.single('file'),
  masterImportController.importFile);

module.exports = router;
