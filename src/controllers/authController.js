const { getDb } = require('../db/database');
const { hashPin, verifyPin, generateToken, isWeakPin, MAX_LOGIN_ATTEMPTS } = require('../utils/auth');

// Normalize CS ID
function normalizeId(val) {
  return String(val == null ? '' : val).trim().replace(/\.0$/, '').toUpperCase();
}

// Status block message
function statusBlockMessage(user) {
  if (user.status === 'MENUNGGU PERSETUJUAN') {
    return { success: false, code: 'PENDING', message: 'Akun Anda masih menunggu persetujuan Unit Head.' };
  }
  if (user.status === 'TERKUNCI') {
    return { success: false, code: 'LOCKED', message: `Akun TERKUNCI karena salah PIN ${MAX_LOGIN_ATTEMPTS} kali. Hanya Unit Head yang dapat membuka kunci & mereset akun Anda.` };
  }
  if (user.status === 'DITOLAK') {
    return { success: false, code: 'REJECTED', message: 'Permintaan akses akun ini ditolak oleh Unit Head.' };
  }
  if (user.status !== 'AKTIF') {
    return { success: false, code: 'DISABLED', message: 'Akun tidak aktif. Hubungi Unit Head.' };
  }
  return null;
}

// Login
async function login(req, res) {
  const { csId, pin } = req.body;
  const cleanId = normalizeId(csId);
  const cleanPin = String(pin == null ? '' : pin).trim();

  if (!cleanId || !cleanPin) {
    return res.status(400).json({ success: false, message: 'CS ID dan PIN wajib diisi.' });
  }

  const db = getDb();

  db.get('SELECT * FROM users WHERE cs_id = ?', [cleanId], async (err, user) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses login.' });
    }

    if (!user) {
      return res.status(401).json({ success: false, code: 'INVALID', message: 'CS ID atau PIN salah. Periksa kembali CS ID Anda.' });
    }

    const blocked = statusBlockMessage(user);
    if (blocked) {
      return res.status(403).json(blocked);
    }

    const valid = await verifyPin(cleanPin, user.password_hash);
    if (!valid) {
      const attempts = (user.failed_attempts || 0) + 1;
      const newStatus = attempts >= MAX_LOGIN_ATTEMPTS ? 'TERKUNCI' : user.status;

      db.run(
        'UPDATE users SET failed_attempts = ?, status = ?, updated_at = datetime("now") WHERE cs_id = ?',
        [attempts, newStatus, cleanId],
        (updateErr) => {
          if (updateErr) console.error('Failed to update attempts:', updateErr.message);
        }
      );

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        return res.status(403).json({
          success: false,
          code: 'LOCKED',
          message: `PIN salah ${attempts} kali. Akun Anda sekarang TERKUNCI. Hubungi Unit Head untuk membuka kunci.`
        });
      }

      return res.status(401).json({
        success: false,
        code: 'WRONG_PIN',
        attemptsLeft: MAX_LOGIN_ATTEMPTS - attempts,
        message: `CS ID atau PIN salah. Sisa percobaan: ${MAX_LOGIN_ATTEMPTS - attempts}x sebelum akun terkunci.`
      });
    }

    // Successful login
    db.run(
      'UPDATE users SET failed_attempts = 0, last_login = datetime("now"), updated_at = datetime("now") WHERE cs_id = ?',
      [cleanId],
      (updateErr) => {
        if (updateErr) console.error('Failed to update login time:', updateErr.message);
      }
    );

    const token = generateToken(user);
    const publicUser = {
      csId: user.cs_id,
      nama: user.nama,
      role: user.role,
      email: user.email || '',
      mustChangePin: !!user.must_change_pin
    };

    res.json({ success: true, token, user: publicUser });
  });
}

// Validate session
function validateSession(req, res) {
  const user = req.user;
  res.json({
    success: true,
    user: {
      csId: user.csId,
      nama: user.nama,
      role: user.role,
      email: user.email || '',
      mustChangePin: !!user.mustChangePin
    }
  });
}

// Logout (client-side token removal, server just acknowledges)
function logout(req, res) {
  res.json({ success: true, message: 'Logout berhasil.' });
}

// Change PIN
async function changePin(req, res) {
  const { oldPin, newPin } = req.body;
  const user = req.user;
  const cleanOld = String(oldPin == null ? '' : oldPin).trim();
  const cleanNew = String(newPin == null ? '' : newPin).trim();

  if (!/^\d{6}$/.test(cleanNew)) {
    return res.status(400).json({ success: false, message: 'PIN baru harus 6 digit angka.' });
  }
  if (cleanNew === cleanOld) {
    return res.status(400).json({ success: false, message: 'PIN baru tidak boleh sama dengan PIN lama.' });
  }
  if (isWeakPin(cleanNew)) {
    return res.status(400).json({ success: false, message: 'PIN terlalu mudah ditebak. Gunakan kombinasi lain.' });
  }

  const db = getDb();

  db.get('SELECT * FROM users WHERE cs_id = ?', [user.csId], async (err, dbUser) => {
    if (err || !dbUser) {
      return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    }

    // If user has existing PIN, verify old PIN
    if (dbUser.password_hash && cleanOld) {
      const valid = await verifyPin(cleanOld, dbUser.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, message: 'PIN lama salah.' });
      }
    }

    const newHash = await hashPin(cleanNew);
    db.run(
      'UPDATE users SET password_hash = ?, must_change_pin = 0, failed_attempts = 0, updated_at = datetime("now") WHERE cs_id = ?',
      [newHash, user.csId],
      (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ success: false, message: 'Gagal memperbarui PIN.' });
        }
        res.json({ success: true, message: 'PIN berhasil diperbarui.' });
      }
    );
  });
}

module.exports = { login, validateSession, logout, changePin };
