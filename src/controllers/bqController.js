const { getDb } = require('../db/database');
const { ownershipClause, canSeeRow } = require('../utils/dataOwnership');

const isSupervisor = (user) => String(user && user.role).toUpperCase() === 'SUPERVISOR';

/**
 * Hari telat dihitung ULANG dari tanggal jatuh tempo sampai hari ini.
 *
 * Kolom `overdue` di database berasal dari file Excel dan sering basi
 * atau bahkan negatif (mis. -23) karena diisi saat file dibuat. Untuk
 * penagihan, angka yang benar adalah selisih hari nyata. Nilai kolom
 * hanya dipakai sebagai cadangan kalau jatuh_tempo kosong/tidak valid.
 *
 * Mengembalikan 0 kalau belum jatuh tempo.
 */
const hitungHariTelat = (jatuhTempo, overdueDb) => {
  const raw = jatuhTempo == null ? '' : String(jatuhTempo).trim();
  if (raw) {
    // Terima YYYY-MM-DD maupun DD/MM/YYYY atau DD-MM-YYYY.
    let y, m, d;
    let mt = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mt) {
      y = +mt[1]; m = +mt[2]; d = +mt[3];
    } else {
      mt = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
    }
    if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const jt = Date.UTC(y, m - 1, d);
      const now = new Date();
      const hariIni = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const selisih = Math.round((hariIni - jt) / 86400000);
      return selisih > 0 ? selisih : 0;
    }
  }
  // Cadangan: pakai kolom DB kalau ada, tapi jangan pernah negatif.
  const v = Number(overdueDb);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
};

const mapRow = (r) => ({
  id: r.id,
  contractNo: r.contract_no,
  customerName: r.customer_name,
  phone: r.phone,
  jatuhTempo: r.jatuh_tempo,
  angsKe: r.angs_ke,
  bebanBq: r.beban_bq,
  installAmt: r.install_amt,
  csId: r.cs_id,
  namaMce: r.nama_mce,
  coriGrade: r.cori_grade,
  alamat: r.alamat,
  plafon: r.plafon,
  unitMotor: r.unit_motor,
  // Dihitung ulang, bukan disalin dari kolom Excel yang sering basi.
  overdue: hitungHariTelat(r.jatuh_tempo, r.overdue),
  statusBq: r.status_bq,
  reason: r.reason,
  janjiBayar: r.janji_bayar,
  lastUpdated: r.updated_at
});

/**
 * Daftar Booking Quality.
 * Marketing hanya melihat data miliknya; Supervisor melihat semua.
 * GET /api/v1/booking-quality?status=&search=&limit=&offset=
 */
exports.listBQ = (req, res) => {
  const user = req.user;
  const { status, search, limit = 50, offset = 0, csId } = req.query;

  const lim = Math.min(parseInt(limit, 10) || 50, 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  let where = ' WHERE 1=1';
  const params = [];

  // Marketing: hanya barisnya. Supervisor: semua, opsional filter csId.
  const own = ownershipClause(user, csId);
  where += own.sql;
  params.push(...own.params);
  if (status) {
    // Status di DB memakai spasi ("BELUM BAYAR"), sedangkan app lama
    // mengirim underscore ("BELUM_BAYAR"). Normalisasi keduanya supaya
    // filter tidak pernah mengembalikan daftar kosong.
    const normalized = String(status).trim().toUpperCase().replace(/_/g, ' ');

    if (normalized === 'JANJI BAYAR') {
      // Janji bayar bukan status tersendiri: sebuah kontrak tetap
      // "BELUM BAYAR" tapi punya tanggal janji. Filter ini menangkap
      // keduanya supaya marketing bisa menagih sesuai janji.
      where += " AND (UPPER(status_bq) = 'JANJI BAYAR' OR janji_bayar IS NOT NULL)";
    } else {
      where += ' AND UPPER(status_bq) = ?';
      params.push(normalized);
    }
  }
  if (search) {
    where += ' AND (contract_no LIKE ? OR UPPER(customer_name) LIKE ?)';
    const term = `%${String(search).trim().toUpperCase()}%`;
    params.push(term, term);
  }

  const db = getDb();

  db.get(`SELECT COUNT(*) AS total FROM booking_quality${where}`, params, (err, countRow) => {
    if (err) {
      console.error('BQ count error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menghitung Booking Quality.' });
    }

    db.all(
      // Urutkan menurut hari telat yang dihitung nyata, bukan kolom
      // overdue dari Excel yang sering basi/negatif.
      `SELECT * FROM booking_quality${where}
       ORDER BY (julianday('now','localtime') - julianday(jatuh_tempo)) DESC,
                jatuh_tempo ASC
       LIMIT ? OFFSET ?`,
      [...params, lim, off],
      (err2, rows) => {
        if (err2) {
          console.error('BQ list error:', err2.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca Booking Quality.' });
        }

        res.json({
          success: true,
          data: (rows || []).map(mapRow),
          pagination: {
            total: countRow ? countRow.total : 0,
            limit: lim,
            offset: off,
            returned: (rows || []).length
          }
        });
      }
    );
  });
};

/**
 * Detail satu kontrak BQ.
 * GET /api/v1/booking-quality/:contractNo
 */
exports.getBQDetail = (req, res) => {
  const contractNo = String(req.params.contractNo || '').replace(/[^0-9]/g, '');
  const user = req.user;

  if (!contractNo) {
    return res.status(400).json({ success: false, code: 'INVALID_CONTRACT', message: 'Nomor kontrak tidak valid.' });
  }

  const db = getDb();
  db.get('SELECT * FROM booking_quality WHERE contract_no = ?', [contractNo], (err, row) => {
    if (err) {
      console.error('BQ detail error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca data.' });
    }

    if (!row) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Data Booking Quality tidak ditemukan.' });
    }

    if (!canSeeRow(user, row.cs_id)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Anda tidak berhak mengakses data kontrak ini.'
      });
    }

    res.json({ success: true, data: mapRow(row) });
  });
};

/**
 * Update status follow-up BQ (janji bayar, status, reason).
 * PUT /api/v1/booking-quality/:contractNo
 */
exports.updateBQ = (req, res) => {
  const contractNo = String(req.params.contractNo || '').replace(/[^0-9]/g, '');
  const user = req.user;
  const { statusBq, reason, janjiBayar } = req.body || {};

  if (!contractNo) {
    return res.status(400).json({ success: false, code: 'INVALID_CONTRACT', message: 'Nomor kontrak tidak valid.' });
  }

  const ALLOWED = ['BELUM BAYAR', 'SUDAH BAYAR', 'JANJI BAYAR', 'TIDAK BISA DIHUBUNGI', 'LUNAS', 'BATAL'];
  if (statusBq && !ALLOWED.includes(String(statusBq).toUpperCase())) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_STATUS',
      message: `Status tidak valid. Pilihan: ${ALLOWED.join(', ')}`
    });
  }

  const db = getDb();
  db.get('SELECT cs_id FROM booking_quality WHERE contract_no = ?', [contractNo], (err, row) => {
    if (err) {
      console.error('BQ update lookup error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca data.' });
    }

    if (!row) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Data Booking Quality tidak ditemukan.' });
    }

    if (!canSeeRow(user, row.cs_id)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Anda tidak berhak mengubah data kontrak ini.'
      });
    }

    db.run(
      `UPDATE booking_quality
       SET status_bq = COALESCE(?, status_bq),
           reason = COALESCE(?, reason),
           janji_bayar = COALESCE(?, janji_bayar),
           updated_at = datetime('now')
       WHERE contract_no = ?`,
      [
        statusBq ? String(statusBq).toUpperCase() : null,
        reason != null ? String(reason).trim() : null,
        janjiBayar != null ? String(janjiBayar).trim() : null,
        contractNo
      ],
      function (updateErr) {
        if (updateErr) {
          console.error('BQ update error:', updateErr.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menyimpan perubahan.' });
        }

        db.get('SELECT * FROM booking_quality WHERE contract_no = ?', [contractNo], (e2, updated) => {
          if (e2) {
            return res.json({ success: true, message: 'Perubahan tersimpan.', changes: this.changes });
          }
          res.json({ success: true, message: 'Perubahan tersimpan.', data: mapRow(updated) });
        });
      }
    );
  });
};

/**
 * Ringkasan BQ per status + total overdue.
 * GET /api/v1/booking-quality/stats/summary
 */
exports.getBQStats = (req, res) => {
  const user = req.user;
  let where = ' WHERE 1=1';
  const params = [];

  const own = ownershipClause(user);
  where += own.sql;
  params.push(...own.params);

  const db = getDb();

  db.all(
    `SELECT status_bq, COUNT(*) AS jumlah, SUM(install_amt) AS total_amt,
            SUM(CASE WHEN jatuh_tempo IS NOT NULL AND jatuh_tempo <> ''
                     THEN MAX(0, CAST(julianday('now','localtime') - julianday(jatuh_tempo) AS INTEGER))
                     ELSE 0 END) AS total_dpd
     FROM booking_quality${where}
     GROUP BY status_bq ORDER BY jumlah DESC`,
    params,
    (err, rows) => {
      if (err) {
        console.error('BQ stats error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca statistik.' });
      }

      db.get(
        `SELECT COUNT(*) AS total,
                SUM(install_amt) AS total_amt,
                SUM(CASE WHEN jatuh_tempo IS NOT NULL AND jatuh_tempo <> ''
                         THEN MAX(0, CAST(julianday('now','localtime') - julianday(jatuh_tempo) AS INTEGER))
                         ELSE 0 END) AS total_dpd
         FROM booking_quality${where}`,
        params,
        (err2, sumRow) => {
          if (err2) {
            return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca ringkasan.' });
          }

          // Janji bayar: kontrak yang punya tanggal janji ATAU berstatus
          // "JANJI BAYAR". Dihitung terpisah karena kontrak yang berjanji
          // biasanya tetap berstatus "BELUM BAYAR" di database.
          db.get(
            `SELECT COUNT(*) AS janji FROM booking_quality${where}
             AND (janji_bayar IS NOT NULL AND TRIM(janji_bayar) <> ''
                  OR UPPER(status_bq) = 'JANJI BAYAR')`,
            params,
            (err3, janjiRow) => {
              if (err3) {
                console.error('BQ janji stats error:', err3.message);
              }

              // Kontrak yang sudah jatuh tempo dan belum dibayar — dipakai
              // untuk notifikasi pengingat dan kartu dashboard.
              db.get(
                `SELECT COUNT(*) AS jatuh_tempo FROM booking_quality${where}
                 AND UPPER(status_bq) <> 'BAYAR'
                 AND UPPER(status_bq) <> 'SUDAH BAYAR'
                 AND UPPER(status_bq) <> 'LUNAS'
                 AND jatuh_tempo IS NOT NULL AND jatuh_tempo <> ''
                 AND date(jatuh_tempo) <= date('now','localtime')`,
                params,
                (err4, tempoRow) => {
                  if (err4) {
                    console.error('BQ jatuh tempo stats error:', err4.message);
                  }

                  const total = sumRow ? sumRow.total || 0 : 0;
                  const janji = janjiRow ? janjiRow.janji || 0 : 0;
                  const jatuhTempo = tempoRow ? tempoRow.jatuh_tempo || 0 : 0;

                  res.json({
                    success: true,
                    data: {
                      totalKontrak: total,
                      totalTunggakan: sumRow ? sumRow.total_amt || 0 : 0,
                      // Tidak pernah negatif lagi (dulu -2953 karena
                      // menjumlah kolom overdue dari Excel).
                      totalDpd: sumRow ? Math.round(sumRow.total_dpd || 0) : 0,
                      janjiBayar: janji,
                      // Persentase dipakai kartu analitik: berapa bagian
                      // dari seluruh kontrak yang masih janji bayar.
                      janjiBayarPersen: total > 0 ? (janji / total) * 100 : 0,
                      jatuhTempo: jatuhTempo,
                      breakdown: (rows || []).map((r) => ({
                        status: r.status_bq || '(kosong)',
                        jumlah: r.jumlah,
                        totalAmt: r.total_amt || 0,
                        totalDpd: Math.round(r.total_dpd || 0)
                      }))
                    }
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

/**
 * Daftar kontrak jatuh tempo milik user yang sedang login.
 *
 * Dipakai app untuk membangun notifikasi lokal di HP masing-masing:
 * setiap marketing hanya menerima pengingat untuk nasabahnya sendiri,
 * supervisor menerima semua.
 *
 * GET /api/v1/booking-quality/jatuh-tempo?limit=20
 */
exports.getJatuhTempo = (req, res) => {
  const user = req.user;
  const lim = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  let where = ' WHERE 1=1';
  const params = [];

  const own = ownershipClause(user);
  where += own.sql;
  params.push(...own.params);

  // Belum lunas dan sudah lewat tanggal jatuh tempo.
  where += ` AND UPPER(COALESCE(status_bq,'')) NOT IN ('BAYAR','SUDAH BAYAR','LUNAS')
             AND jatuh_tempo IS NOT NULL AND TRIM(jatuh_tempo) <> ''
             AND date(jatuh_tempo) <= date('now','localtime')`;

  const db = getDb();

  db.all(
    `SELECT contract_no, customer_name, phone, jatuh_tempo, install_amt,
            angs_ke, status_bq, janji_bayar,
            CAST(julianday('now','localtime') - julianday(jatuh_tempo) AS INTEGER) AS telat
       FROM booking_quality${where}
      ORDER BY telat DESC
      LIMIT ?`,
    [...params, lim],
    (err, rows) => {
      if (err) {
        console.error('Jatuh tempo list error:', err.message);
        return res.status(500).json({
          success: false,
          code: 'DB_ERROR',
          message: 'Gagal membaca daftar jatuh tempo.',
        });
      }

      const data = (rows || []).map((r) => ({
        contractNo: r.contract_no,
        customerName: r.customer_name,
        phone: r.phone,
        jatuhTempo: r.jatuh_tempo,
        installAmt: r.install_amt || 0,
        angsKe: r.angs_ke,
        statusBq: r.status_bq,
        janjiBayar: r.janji_bayar,
        hariTelat: r.telat > 0 ? r.telat : 0,
      }));

      res.json({
        success: true,
        data: {
          jumlah: data.length,
          totalTunggakan: data.reduce((s, d) => s + (d.installAmt || 0), 0),
          telatTerlama: data.length ? data[0].hariTelat : 0,
          items: data,
        },
      });
    }
  );
};
