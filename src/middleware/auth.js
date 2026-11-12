const { verifyToken } = require('../utils/auth');
const { getDb } = require('../db/database');

// Require valid JWT token
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.'
    });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.'
    });
  }

  // Check if PIN change is required
  if (decoded.mustChangePin && !req.path.includes('/change-pin')) {
    return res.status(403).json({
      success: false,
      code: 'PIN_CHANGE_REQUIRED',
      message: 'Anda wajib mengganti PIN sementara terlebih dahulu.'
    });
  }

  req.user = decoded;

  // Status akun bisa berubah setelah token diterbitkan (dinonaktifkan,
  // dikunci, atau PIN direset oleh Unit Head). Token berlaku 6 jam, jadi
  // status disegarkan dari DB tiap request — jangan percaya salinan di token.
  getDb().get('SELECT status, role FROM users WHERE cs_id = ?', [decoded.csId], (err, row) => {
    if (err) {
      console.error('Auth status check error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal memverifikasi sesi.' });
    }
    if (!row) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Akun tidak ditemukan lagi. Silakan login kembali.'
      });
    }
    if (row.status !== 'AKTIF') {
      return res.status(403).json({
        success: false,
        code: row.status === 'TERKUNCI' ? 'LOCKED' : 'DISABLED',
        message: 'Akun tidak aktif. Hubungi Unit Head.'
      });
    }

    // Role terbaru menang atas role di token.
    req.user.role = row.role;
    next();
  });
}

// Require supervisor role
function requireSupervisor(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Sesi tidak valid.'
    });
  }

  const role = String(req.user.role || '').toUpperCase();
  if (role !== 'SUPERVISOR' && role !== 'UNIT HEAD') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Hanya Unit Head yang dapat melakukan aksi ini.'
    });
  }

  next();
}

module.exports = { requireAuth, requireSupervisor };
