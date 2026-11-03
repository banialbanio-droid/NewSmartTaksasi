const { getDb } = require('../db/database');
const { OAuth2Client } = require('google-auth-library');

const FIREBASE_WEB_CLIENT_ID = process.env.FIREBASE_WEB_CLIENT_ID;

async function verifyFirebaseToken(token) {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: FIREBASE_WEB_CLIENT_ID
  });
  return ticket.getPayload();
}

function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.'
    });
  }

  const token = authHeader.substring(7);
  verifyFirebaseToken(token)
    .then(payload => {
      if (!payload.email_verified) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Email belum diverifikasi. Hubungi Unit Head untuk verifikasi email.'
        });
      }

      const db = getDb();
      db.get('SELECT cs_id, nama, role, email FROM users WHERE email = ?', [payload.email], (err, user) => {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).json({ success: false, message: 'Gagal memproses token.' });
        }

        if (!user) {
          return res.status(403).json({
            success: false,
            code: 'USER_NOT_FOUND',
            message: 'Akun tidak ditemukan di database. Hubungi Unit Head.'
          });
        }

        const blocked = statusBlockMessage(user);
        if (blocked) {
          return res.status(403).json(blocked);
        }

        req.user = {
          csId: user.cs_id,
          nama: user.nama,
          role: user.role,
          email: user.email
        };
        next();
      });
    })
    .catch(err => {
      console.error('Token verification error:', err);
      res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Token Firebase tidak valid atau sudah expired. Silakan login kembali.'
      });
    });
}

function statusBlockMessage(user) {
  if (user.status === 'MENUNGGU PERSETUJUAN') {
    return { success: false, code: 'PENDING', message: 'Akun Anda masih menunggu persetujuan Unit Head.' };
  }
  if (user.status === 'TERKUNCI') {
    return { success: false, code: 'LOCKED', message: `Akun TERKUNCI karena salah PIN ${user.failed_attempts || 0} kali. Hubungi Unit Head untuk membuka kunci.` };
  }
  if (user.status === 'DITOLAK') {
    return { success: false, code: 'REJECTED', message: 'Permintaan akses akun ini ditolak oleh Unit Head.' };
  }
  if (user.status !== 'AKTIF') {
    return { success: false, code: 'DISABLED', message: 'Akun tidak aktif. Hubungi Unit Head.' };
  }
  return null;
}

module.exports = { requireFirebaseAuth };