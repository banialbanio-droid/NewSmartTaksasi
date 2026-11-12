const { getDb } = require('../db/database');

const isSupervisor = (user) => String(user && user.role).toUpperCase() === 'SUPERVISOR';

/** Periode berjalan, format YYYY-MM. */
const periodeSekarang = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Validasi YYYY-MM; kosong -> periode berjalan. */
const normalisasiPeriode = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  return periodeSekarang();
};

const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const mapTarget = (r) => ({
  id: r.id,
  csId: r.cs_id,
  nama: r.nama || null,
  periode: r.periode,
  targetBq: r.target_bq || 0,
  targetGform: r.target_gform || 0,
  targetRo: r.target_ro || 0,
  targetTaksasi: r.target_taksasi || 0,
  targetBooking: r.target_booking || 0,
  catatan: r.catatan,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

/**
 * Daftar target satu periode beserta capaian nyata.
 *
 * Semua marketing boleh melihat (supaya saling terpacu), tapi hanya
 * supervisor yang boleh menulis — pengecekan ada di endpoint simpan.
 *
 * GET /api/v1/targets?periode=YYYY-MM
 */
exports.listTargets = (req, res) => {
  const user = req.user;
  const periode = normalisasiPeriode(req.query.periode);
  const db = getDb();

  // Hanya marketing aktif yang ditampilkan sebagai baris target.
  db.all(
    `SELECT u.cs_id, u.nama,
            t.id, t.periode, t.target_bq, t.target_gform, t.target_ro,
            t.target_taksasi, t.target_booking, t.catatan, t.created_by,
            t.updated_at
       FROM users u
       LEFT JOIN marketing_targets t
              ON t.cs_id = u.cs_id AND t.periode = ?
      WHERE UPPER(u.role) = 'MARKETING'
      ORDER BY u.nama ASC`,
    [periode],
    (err, rows) => {
      if (err) {
        console.error('List targets error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca target.' });
      }

      // Capaian dihitung dari data nyata periode berjalan. Untuk periode
      // lampau kita tidak punya snapshot harian, jadi capaian hanya
      // ditampilkan untuk periode yang sedang berjalan.
      const bulanIni = periode === periodeSekarang();

      const hitungCapaian = (cb) => {
        if (!bulanIni) return cb({});
        db.all(
          `SELECT owner_cs_id AS cs, COUNT(*) AS n
             FROM booking_quality
            WHERE owner_cs_id IS NOT NULL
              AND UPPER(status_bq) IN ('BAYAR','SUDAH BAYAR','LUNAS')
              AND strftime('%Y-%m', updated_at) = ?
            GROUP BY owner_cs_id`,
          [periode],
          (e1, bqRows) => {
            db.all(
              `SELECT owner_cs_id AS cs, COUNT(*) AS n
                 FROM repeat_orders
                WHERE owner_cs_id IS NOT NULL
                  AND UPPER(status_followup) IN ('SUDAH RO','MINAT')
                  AND strftime('%Y-%m', updated_at) = ?
                GROUP BY owner_cs_id`,
              [periode],
              (e2, roRows) => {
                const map = {};
                const isi = (rows2, key) => {
                  (rows2 || []).forEach((r) => {
                    if (!r.cs) return;
                    map[r.cs] = map[r.cs] || {};
                    map[r.cs][key] = r.n;
                  });
                };
                isi(bqRows, 'bq');
                isi(roRows, 'gform');
                cb(map);
              }
            );
          }
        );
      };

      hitungCapaian((capaian) => {
        const data = (rows || []).map((r) => {
          const c = capaian[r.cs_id] || {};
          return {
            ...mapTarget(r),
            // Nama kolom `nama` dari join users.
            nama: r.nama,
            capaiBq: c.bq || 0,
            capaiGform: c.gform || 0,
            // Taksasi & RO tidak punya penanda periode di data mentah,
            // jadi capaiannya 0 sampai ada pencatatan aktivitas.
            capaiRo: 0,
            capaiTaksasi: 0,
          };
        });

        const totalTarget = data.reduce((s, d) => s + d.targetBq, 0);
        const totalCapai = data.reduce((s, d) => s + d.capaiBq, 0);

        res.json({
          success: true,
          data: {
            periode,
            isPeriodeBerjalan: bulanIni,
            bisaEdit: isSupervisor(user),
            ringkasan: {
              totalTargetBq: totalTarget,
              totalCapaiBq: totalCapai,
              persen: totalTarget > 0 ? (totalCapai / totalTarget) * 100 : 0,
              jumlahMarketing: data.length,
            },
            items: data,
          },
        });
      });
    }
  );
};

/**
 * Simpan target satu marketing (hanya supervisor).
 * Body: { csId, periode, targetBq, targetGform, targetRo, targetTaksasi, catatan }
 * POST /api/v1/targets
 */
exports.simpanTarget = (req, res) => {
  const user = req.user;
  if (!isSupervisor(user)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Hanya supervisor yang boleh mengatur target.',
    });
  }

  const { csId, periode, targetBq, targetGform, targetRo, targetTaksasi, targetBooking, catatan } = req.body || {};
  const cs = String(csId == null ? '' : csId).trim();
  if (!cs) {
    return res.status(400).json({ success: false, code: 'INVALID_CS', message: 'CS ID wajib diisi.' });
  }

  const per = normalisasiPeriode(periode);
  const db = getDb();

  // Pastikan CS ID memang user marketing yang terdaftar.
  db.get('SELECT cs_id, role FROM users WHERE cs_id = ?', [cs], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal memeriksa user.' });
    }
    if (!row) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'CS ID tidak terdaftar.' });
    }
    if (String(row.role).toUpperCase() !== 'MARKETING') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROLE',
        message: 'Target hanya bisa diberikan kepada marketing.',
      });
    }

    db.run(
      `INSERT INTO marketing_targets
         (cs_id, periode, target_bq, target_gform, target_ro, target_taksasi,
          target_booking, catatan, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cs_id, periode) DO UPDATE SET
         target_bq      = excluded.target_bq,
         target_gform   = excluded.target_gform,
         target_ro      = excluded.target_ro,
         target_taksasi = excluded.target_taksasi,
         target_booking = excluded.target_booking,
         catatan        = excluded.catatan,
         updated_at     = datetime('now')`,
      [
        cs,
        per,
        angka(targetBq),
        angka(targetGform),
        angka(targetRo),
        angka(targetTaksasi),
        angka(targetBooking),
        catatan != null ? String(catatan).trim() : null,
        user && user.csId ? user.csId : null,
      ],
      function (e2) {
        if (e2) {
          console.error('Simpan target error:', e2.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menyimpan target.' });
        }
        res.json({
          success: true,
          message: 'Target tersimpan.',
          data: { csId: cs, periode: per },
        });
      }
    );
  });
};

/**
 * Hapus target satu marketing pada satu periode (hanya supervisor).
 * DELETE /api/v1/targets/:csId?periode=YYYY-MM
 */
exports.hapusTarget = (req, res) => {
  const user = req.user;
  if (!isSupervisor(user)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Hanya supervisor yang boleh menghapus target.',
    });
  }

  const cs = String(req.params.csId || '').trim();
  const per = normalisasiPeriode(req.query.periode);
  if (!cs) {
    return res.status(400).json({ success: false, code: 'INVALID_CS', message: 'CS ID wajib diisi.' });
  }

  const db = getDb();
  db.run(
    'DELETE FROM marketing_targets WHERE cs_id = ? AND periode = ?',
    [cs, per],
    function (err) {
      if (err) {
        console.error('Hapus target error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menghapus target.' });
      }
      res.json({ success: true, message: 'Target dihapus.' });
    }
  );
};

/** Dipakai controller lain kalau perlu. */
exports.hitungHariTelat = (jatuhTempo) => {
  const raw = jatuhTempo == null ? '' : String(jatuhTempo).trim();
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return 0;
  const jt = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const hariIni = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const s = Math.round((hariIni - jt) / 86400000);
  return s > 0 ? s : 0;
};
