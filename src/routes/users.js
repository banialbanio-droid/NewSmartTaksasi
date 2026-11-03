const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userAdminController');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

// Semua endpoint di sini hanya untuk Supervisor / Unit Head.
router.use(requireAuth, requireSupervisor);

router.get('/summary', ctrl.summary);
router.post('/reassign', ctrl.reassignOwnership);
router.get('/unlinked', ctrl.listUnlinked);
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.patch('/:csId', ctrl.updateUser);
router.post('/:csId/reset-pin', ctrl.resetPin);
router.delete('/:csId', ctrl.deleteUser);

module.exports = router;
