const { getDb } = require('../db/database');
const { hashPin, isWeakPin } = require('../utils/auth');

const normalizeId = (v) => String(v == null ? '' : v).trim().replace(/\.0$/, '').toUpperCase();

const ROLES = ['MARKETING', 'SUPERVISOR'];
const STATUSES = ['AKTIF', 'NONAKTIF', 'TERKUNCI', 'MENUNGGU PERSETUJUAN'];

const fail = (res, status, code, message) =>
  res.status(status).json({ success: false, code, message });

const mapUser = (r) => ({
  csId: r.cs_id,
  nama: r.nama,
  role: r.role,
  status: r.status,
  email: r.email || '',
  lastLogin: r.last_login,
  mustChangePin: !!r.must_change_pin,
  bqCount: r.bq_count || 0,
  roCount: r.ro_count || 0,
  bqTitipan: r.bq_titipan || 0,
  roTitipan: r.ro_titipan || 0,
  createdAt: r.created_at
});

/**
 * Daftar user + jumlah data BQ / Gform yang menempel ke CS ID tersebut.
 * GET /api/v1/users?search=&role=&status=
 */
exports.listUsers = (req, res) => {
  const { search, role, status } = req.query;

  let where = ' WHERE 1=1';
  const params = [];

  if (role) {
    where += ' AND UPPER(u.role) = ?';
    params.push(String(role).trim().toUpperCase());
  }
  if (status) {
    where += ' AND UPPER(u.status) = ?';
    params.push(String(status).trim().toUpperCase());
  }
  if (search) {
    where += ' AND (u.cs_id LIKE ? OR UPPER(u.nama) LIKE ?)';
    const term = `%${String(search).trim().toUpperCase()}%`;
    params.push(term, term);
  }

  const db = getDb();

  db.all(
    `SELECT u.*,
            (SELECT COUNT(*) FROM booking_quality b
              WHERE b.owner_cs_id = u.cs_id) AS bq_count,
            (SELECT COUNT(*) FROM repeat_orders r
              WHERE r.owner_cs_id = u.cs_id) AS ro_count,
            (SELECT COUNT(*) FROM booking_quality b
              WHERE b.owner_cs_id = u.cs_id
                AND b.cs_id <> u.cs_id) AS bq_titipan,
            (SELECT COUNT(*) FROM repeat_orders r
              WHERE r.owner_cs_id = u.cs_id
                AND r.cs_id <> u.cs_id) AS ro_titipan
       FROM users u${where}
      ORDER BY CASE UPPER(u.role) WHEN 'SUPERVISOR' THEN 0 ELSE 1 END,
               u.nama ASC`,
    params,
    (err, rows) => {
      if (err) {
        console.error('listUsers error:', err.message);
        return fail(res, 500, 'DB_ERROR', 'Gagal membaca daftar user.');
      }
      res.json({ success: true, data: (rows || []).map(mapUser) });
    }
  );
};

/**
 * CS ID yang punya data BQ / Gform tapi belum punya akun user.
 * Ini yang membuat data "yatim" tidak bisa diakses siapa pun.
 * GET /api/v1/users/unlinked
 */
exports.listUnlinked = (req, res) => {
  const db = getDb();

  db.all(
    `SELECT cs_id,
            MAX(nama_mce) AS nama,
            COUNT(*) AS total,
            'BQ' AS source
       FROM booking_quality
      WHERE cs_id IS NOT NULL AND TRIM(cs_id) <> ''
        AND cs_id NOT IN (SELECT cs_id FROM users)
      GROUP BY cs_id
      UNION ALL
     SELECT cs_id,
            MAX(nama_mce) AS nama,
            COUNT(*) AS total,
            'GFORM' AS source
       FROM repeat_orders
      WHERE cs_id IS NOT NULL AND TRIM(cs_id) <> ''
        AND cs_id NOT IN (SELECT cs_id FROM users)
      GROUP BY cs_id`,
    [],
    (err, rows) => {
      if (err) {
        console.error('listUnlinked error:', err.message);
        return fail(res, 500, 'DB_ERROR', 'Gagal membaca CS ID tanpa akun.');
      }

      // Gabungkan per CS ID (BQ + GFORM jadi satu baris).
      const merged = new Map();
      for (const r of rows || []) {
        const id = normalizeId(r.cs_id);
        if (!id) continue;
        const cur = merged.get(id) || {
          csId: id,
          nama: r.nama || '',
          bqCount: 0,
          roCount: 0
        };
        if (!cur.nama && r.nama) cur.nama = r.nama;
        if (r.source === 'BQ') cur.bqCount += r.total;
        else cur.roCount += r.total;
        merged.set(id, cur);
      }

      res.json({
        success: true,
        data: [...merged.values()].sort(
          (a, b) => b.bqCount + b.roCount - (a.bqCount + a.roCount)
        )
      });
    }
  );
};

/**
 * Tambah user baru. PIN sementara wajib diganti saat login pertama.
 * POST /api/v1/users
 */
exports.createUser = async (req, res) => {
  const csId = normalizeId(req.body.csId);
  const nama = String(req.body.nama || '').trim();
  const role = String(req.body.role || 'MARKETING').trim().toUpperCase();
  const email = String(req.body.email || '').trim();
  const pin = String(req.body.pin || '').trim();

  if (!csId) return fail(res, 400, 'VALIDATION', 'CS ID wajib diisi.');
  if (!nama) return fail(res, 400, 'VALIDATION', 'Nama wajib diisi.');
  if (!ROLES.includes(role)) return fail(res, 400, 'VALIDATION', 'Role tidak dikenal.');
  if (!/^\d{6}$/.test(pin)) return fail(res, 400, 'VALIDATION', 'PIN harus 6 digit angka.');

  const db = getDb();

  db.get('SELECT cs_id FROM users WHERE cs_id = ?', [csId], async (err, exists) => {
    if (err) return fail(res, 500, 'DB_ERROR', 'Gagal memeriksa CS ID.');
    if (exists) {
      return fail(res, 409, 'DUPLICATE', `CS ID ${csId} sudah terdaftar.`);
    }

    let hash;
    try {
      hash = await hashPin(pin);
    } catch (e) {
      console.error('hashPin error:', e.message);
      return fail(res, 500, 'HASH_ERROR', 'Gagal mengamankan PIN.');
    }

    db.run(
      `INSERT INTO users (cs_id, nama, password_hash, role, status, email,
                          failed_attempts, must_change_pin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'AKTIF', ?, 0, ?, datetime('now'), datetime('now'))`,
      [csId, nama, hash, role, email, isWeakPin(pin) ? 1 : 0],
      function (insErr) {
        if (insErr) {
          console.error('createUser error:', insErr.message);
          return fail(res, 500, 'DB_ERROR', 'Gagal menambah user.');
        }

        // Data BQ/Gform yang CS ID-nya sama otomatis jadi milik user ini.
        db.run(
          'UPDATE booking_quality SET nama_mce = ? WHERE cs_id = ?',
          [nama, csId],
          () => {
            db.run('UPDATE repeat_orders SET nama_mce = ? WHERE cs_id = ?', [nama, csId], () => {
              res.json({
                success: true,
                message: `User ${nama} berhasil ditambahkan.`,
                data: {
                  csId,
                  nama,
                  role,
                  status: 'AKTIF',
                  email,
                  mustChangePin: isWeakPin(pin),
                  weakPin: isWeakPin(pin)
                }
              });
            });
          }
        );
      }
    );
  });
};

/**
 * Ubah user: nama, role, status, email. CS ID tidak bisa diubah
 * karena jadi kunci data BQ / Gform.
 * PATCH /api/v1/users/:csId
 */
exports.updateUser = (req, res) => {
  const csId = normalizeId(req.params.csId);
  const { nama, role, status, email } = req.body;

  if (!csId) return fail(res, 400, 'VALIDATION', 'CS ID tidak valid.');

  const sets = [];
  const params = [];

  if (nama != null) {
    const v = String(nama).trim();
    if (!v) return fail(res, 400, 'VALIDATION', 'Nama tidak boleh kosong.');
    sets.push('nama = ?');
    params.push(v);
  }
  if (role != null) {
    const v = String(role).trim().toUpperCase();
    if (!ROLES.includes(v)) return fail(res, 400, 'VALIDATION', 'Role tidak dikenal.');
    sets.push('role = ?');
    params.push(v);
  }
  if (status != null) {
    const v = String(status).trim().toUpperCase();
    if (!STATUSES.includes(v)) return fail(res, 400, 'VALIDATION', 'Status tidak dikenal.');
    sets.push('status = ?');
    params.push(v);
    if (v === 'AKTIF') {
      sets.push('failed_attempts = 0');
    }
  }
  if (email != null) {
    sets.push('email = ?');
    params.push(String(email).trim());
  }

  if (sets.length === 0) return fail(res, 400, 'VALIDATION', 'Tidak ada perubahan.');

  sets.push("updated_at = datetime('now')");
  params.push(csId);

  const db = getDb();
  db.run(`UPDATE users SET ${sets.join(', ')} WHERE cs_id = ?`, params, function (err) {
    if (err) {
      console.error('updateUser error:', err.message);
      return fail(res, 500, 'DB_ERROR', 'Gagal memperbarui user.');
    }
    if (this.changes === 0) return fail(res, 404, 'NOT_FOUND', 'User tidak ditemukan.');

    // Sinkronkan nama di data BQ / Gform kalau nama berubah.
    if (nama != null) {
      const v = String(nama).trim();
      db.run('UPDATE booking_quality SET nama_mce = ? WHERE cs_id = ?', [v, csId], () => {
        db.run('UPDATE repeat_orders SET nama_mce = ? WHERE cs_id = ?', [v, csId], () => {
          res.json({ success: true, message: 'User diperbarui.' });
        });
      });
      return;
    }
    res.json({ success: true, message: 'User diperbarui.' });
  });
};

/**
 * Reset PIN ke PIN sementara (wajib ganti saat login).
 * POST /api/v1/users/:csId/reset-pin
 */
exports.resetPin = async (req, res) => {
  const csId = normalizeId(req.params.csId);
  const pin = String(req.body.pin || '').trim();

  if (!/^\d{6}$/.test(pin)) return fail(res, 400, 'VALIDATION', 'PIN harus 6 digit angka.');

  let hash;
  try {
    hash = await hashPin(pin);
  } catch (e) {
    return fail(res, 500, 'HASH_ERROR', 'Gagal mengamankan PIN.');
  }

  const db = getDb();
  db.run(
    `UPDATE users SET password_hash = ?, must_change_pin = ?, failed_attempts = 0,
                      status = CASE WHEN status = 'TERKUNCI' THEN 'AKTIF' ELSE status END,
                      updated_at = datetime('now')
      WHERE cs_id = ?`,
    [hash, isWeakPin(pin) ? 1 : 0, csId],
    function (err) {
      if (err) {
        console.error('resetPin error:', err.message);
        return fail(res, 500, 'DB_ERROR', 'Gagal mereset PIN.');
      }
      if (this.changes === 0) return fail(res, 404, 'NOT_FOUND', 'User tidak ditemukan.');
      res.json({ success: true, message: `PIN ${csId} sudah direset.` });
    }
  );
};

/**
 * Hapus user. Hanya boleh kalau tidak ada data BQ / Gform yang menempel,
 * atau kalau user memang sudah NONAKTIF. Data historis tidak boleh yatim.
 * DELETE /api/v1/users/:csId?force=1
 */
exports.deleteUser = (req, res) => {
  const csId = normalizeId(req.params.csId);
  const force = String(req.query.force || '') === '1';

  if (!csId) return fail(res, 400, 'VALIDATION', 'CS ID tidak valid.');
  if (req.user && normalizeId(req.user.csId) === csId) {
    return fail(res, 400, 'SELF_DELETE', 'Tidak bisa menghapus akun yang sedang dipakai.');
  }

  const db = getDb();

  db.get('SELECT cs_id, nama, status FROM users WHERE cs_id = ?', [csId], (err, user) => {
    if (err) return fail(res, 500, 'DB_ERROR', 'Gagal membaca user.');
    if (!user) return fail(res, 404, 'NOT_FOUND', 'User tidak ditemukan.');

    db.get(
      `SELECT (SELECT COUNT(*) FROM booking_quality WHERE cs_id = ?) AS bq,
              (SELECT COUNT(*) FROM repeat_orders WHERE cs_id = ?) AS ro`,
      [csId, csId],
      (err2, counts) => {
        if (err2) return fail(res, 500, 'DB_ERROR', 'Gagal memeriksa data terkait.');

        const total = (counts.bq || 0) + (counts.ro || 0);

        // Ada data terkait -> jangan hapus permanen, nonaktifkan saja.
        if (total > 0 && !force) {
          return res.status(409).json({
            success: false,
            code: 'HAS_DATA',
            message:
              `User ini punya ${counts.bq} data BQ dan ${counts.ro} data Gform. ` +
              'Hapus permanen akan membuat data itu tidak bisa diakses. ' +
              'Gunakan Nonaktifkan, atau kirim ?force=1 kalau tetap ingin dihapus.',
            bqCount: counts.bq || 0,
            roCount: counts.ro || 0
          });
        }

        db.run('DELETE FROM users WHERE cs_id = ?', [csId], (delErr) => {
          if (delErr) {
            console.error('deleteUser error:', delErr.message);
            return fail(res, 500, 'DB_ERROR', 'Gagal menghapus user.');
          }
          res.json({ success: true, message: `${user.nama} dihapus.` });
        });
      }
    );
  });
};

/**
 * Ringkasan untuk dashboard pengaturan user.
 * GET /api/v1/users/summary
 */
exports.summary = (req, res) => {
  const db = getDb();
  db.get(
    `SELECT
       (SELECT COUNT(*) FROM users) AS total,
       (SELECT COUNT(*) FROM users WHERE UPPER(status) = 'AKTIF') AS aktif,
       (SELECT COUNT(*) FROM users WHERE UPPER(status) = 'TERKUNCI') AS terkunci,
       (SELECT COUNT(*) FROM users WHERE UPPER(status) <> 'AKTIF') AS nonaktif,
       (SELECT COUNT(*) FROM users WHERE UPPER(role) = 'SUPERVISOR') AS supervisor,
       (SELECT COUNT(*) FROM users WHERE UPPER(role) = 'MARKETING') AS marketing,
       (SELECT COUNT(DISTINCT cs_id) FROM booking_quality
         WHERE cs_id NOT IN (SELECT cs_id FROM users)) AS bq_unlinked,
       (SELECT COUNT(DISTINCT cs_id) FROM repeat_orders
         WHERE cs_id NOT IN (SELECT cs_id FROM users)) AS ro_unlinked`,
    [],
    (err, row) => {
      if (err) {
        console.error('summary error:', err.message);
        return fail(res, 500, 'DB_ERROR', 'Gagal membaca ringkasan user.');
      }
      res.json({ success: true, data: row });
    }
  );
};

/**
 * Rapikan pemilik data: setiap baris BQ/Gform yang CS ID-nya punya akun
 * dimiliki user itu; yang tidak punya akun menempel ke supervisor pemegang.
 *
 * Aman dijalankan berulang (idempotent).
 * POST /api/v1/users/reassign
 */
exports.reassignOwnership = (req, res) => {
  const { CUSTODIAN_CS_ID } = require('../utils/dataOwnership');
  const db = getDb();

  const custodian = normalizeId(req.body.custodian || CUSTODIAN_CS_ID);

  db.get(
    'SELECT cs_id, nama FROM users WHERE cs_id = ?',
    [custodian],
    (uErr, spv) => {
      if (uErr) return fail(res, 500, 'DB_ERROR', 'Gagal memeriksa supervisor.');
      if (!spv) {
        return fail(res, 400, 'NO_CUSTODIAN',
          `CS ID ${custodian} tidak terdaftar sebagai user. Tentukan supervisor pemegang data.`);
      }

      const sql = `UPDATE %TABLE%
                      SET owner_cs_id = CASE
                            WHEN cs_id IN (SELECT cs_id FROM users) THEN cs_id
                            WHEN cs_id IS NULL OR TRIM(cs_id) = '' THEN ?
                            ELSE ? END`;

      db.run(sql.replace('%TABLE%', 'booking_quality'), [custodian, custodian],
        function (e1) {
          if (e1) return fail(res, 500, 'DB_ERROR', 'Gagal merapikan pemilik BQ.');
          const bq = this.changes;

          db.run(sql.replace('%TABLE%', 'repeat_orders'), [custodian, custodian],
            function (e2) {
              if (e2) return fail(res, 500, 'DB_ERROR', 'Gagal merapikan pemilik Gform.');
              const ro = this.changes;

              db.get(
                `SELECT
                   (SELECT COUNT(*) FROM booking_quality
                     WHERE owner_cs_id = ?) AS bq_custodian,
                   (SELECT COUNT(*) FROM repeat_orders
                     WHERE owner_cs_id = ?) AS ro_custodian,
                   (SELECT COUNT(DISTINCT cs_id) FROM booking_quality
                     WHERE cs_id NOT IN (SELECT cs_id FROM users)) AS unlinked_ids`,
                [custodian, custodian],
                (e3, stat) => {
                  res.json({
                    success: true,
                    message: `Pemilik data dirapikan. Data titipan menempel ke ${spv.nama}.`,
                    data: {
                      custodian,
                      custodianName: spv.nama,
                      bqTouched: bq,
                      roTouched: ro,
                      bqOnCustodian: stat ? stat.bq_custodian : 0,
                      roOnCustodian: stat ? stat.ro_custodian : 0,
                      unlinkedCsIds: stat ? stat.unlinked_ids : 0,
                    },
                  });
                }
              );
            }
          );
        }
      );
    }
  );
};
