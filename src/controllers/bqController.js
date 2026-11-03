const { getDb } = require('../db/database');
const { ownershipClause, canSeeRow } = require('../utils/dataOwnership');

const isSupervisor = (user) => String(user && user.role).toUpperCase() === 'SUPERVISOR';

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
  overdue: r.overdue,
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
    where += ' AND UPPER(status_bq) = ?';
    params.push(String(status).trim().toUpperCase());
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
      `SELECT * FROM booking_quality${where} ORDER BY overdue DESC, jatuh_tempo ASC LIMIT ? OFFSET ?`,
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
    `SELECT status_bq, COUNT(*) AS jumlah, SUM(install_amt) AS total_amt, SUM(overdue) AS total_dpd
     FROM booking_quality${where}
     GROUP BY status_bq ORDER BY jumlah DESC`,
    params,
    (err, rows) => {
      if (err) {
        console.error('BQ stats error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca statistik.' });
      }

      db.get(
        `SELECT COUNT(*) AS total, SUM(overdue) AS total_dpd, SUM(install_amt) AS total_amt
         FROM booking_quality${where}`,
        params,
        (err2, sumRow) => {
          if (err2) {
            return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca ringkasan.' });
          }

          res.json({
            success: true,
            data: {
              totalKontrak: sumRow ? sumRow.total : 0,
              totalTunggakan: sumRow ? sumRow.total_amt || 0 : 0,
              totalDpd: sumRow ? sumRow.total_dpd || 0 : 0,
              breakdown: (rows || []).map((r) => ({
                status: r.status_bq || '(kosong)',
                jumlah: r.jumlah,
                totalAmt: r.total_amt || 0,
                totalDpd: r.total_dpd || 0
              }))
            }
          });
        }
      );
    }
  );
};
