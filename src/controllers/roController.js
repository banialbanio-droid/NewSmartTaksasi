const { getDb } = require('../db/database');
const { ownershipClause, canSeeRow } = require('../utils/dataOwnership');

const isSupervisor = (user) => String(user && user.role).toUpperCase() === 'SUPERVISOR';

const mapRow = (r) => ({
  id: r.id,
  csId: r.cs_id,
  namaMce: r.nama_mce,
  contractNo: r.contract_no,
  customerName: r.customer_name,
  phone: r.phone,
  coriGrade: r.cori_grade,
  brand: r.brand,
  tahun: r.tahun,
  objCode: r.obj_code,
  objType: r.obj_type,
  objModel: r.obj_model,
  objDesc: r.obj_desc,
  noPolisi: r.no_polisi,
  sisaAngsuran: r.sisa_angsuran,
  statusFollowup: r.status_followup,
  catatan: r.catatan,
  updatedAt: r.updated_at
});

const ALLOWED_STATUS = ['BARU', 'DIHUBUNGI', 'MINAT', 'TIDAK MINAT', 'SUDAH RO', 'TIDAK BISA DIHUBUNGI'];

/**
 * Daftar Repeat Order.
 * Marketing hanya melihat miliknya; Supervisor melihat semua.
 * GET /api/v1/repeat-order?status=&search=&limit=&offset=
 */
exports.listRO = (req, res) => {
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
    where += ' AND UPPER(status_followup) = ?';
    params.push(String(status).trim().toUpperCase());
  }
  if (search) {
    where += ' AND (contract_no LIKE ? OR UPPER(customer_name) LIKE ? OR UPPER(no_polisi) LIKE ?)';
    const term = `%${String(search).trim().toUpperCase()}%`;
    params.push(term, term, term);
  }

  const db = getDb();

  db.get(`SELECT COUNT(*) AS total FROM repeat_orders${where}`, params, (err, countRow) => {
    if (err) {
      console.error('RO count error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menghitung Repeat Order.' });
    }

    db.all(
      `SELECT * FROM repeat_orders${where} ORDER BY sisa_angsuran ASC, customer_name ASC LIMIT ? OFFSET ?`,
      [...params, lim, off],
      (err2, rows) => {
        if (err2) {
          console.error('RO list error:', err2.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca Repeat Order.' });
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
 * Detail Repeat Order per kontrak.
 * GET /api/v1/repeat-order/:contractNo
 */
exports.getRODetail = (req, res) => {
  const contractNo = String(req.params.contractNo || '').replace(/[^0-9]/g, '');
  const user = req.user;

  if (!contractNo) {
    return res.status(400).json({ success: false, code: 'INVALID_CONTRACT', message: 'Nomor kontrak tidak valid.' });
  }

  const db = getDb();
  db.get('SELECT * FROM repeat_orders WHERE contract_no = ?', [contractNo], (err, row) => {
    if (err) {
      console.error('RO detail error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca data.' });
    }

    if (!row) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Data Repeat Order tidak ditemukan.' });
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
 * Update status follow-up RO.
 * PUT /api/v1/repeat-order/:contractNo
 */
exports.updateRO = (req, res) => {
  const contractNo = String(req.params.contractNo || '').replace(/[^0-9]/g, '');
  const user = req.user;
  const { statusFollowup, catatan } = req.body || {};

  if (!contractNo) {
    return res.status(400).json({ success: false, code: 'INVALID_CONTRACT', message: 'Nomor kontrak tidak valid.' });
  }

  if (statusFollowup && !ALLOWED_STATUS.includes(String(statusFollowup).toUpperCase())) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_STATUS',
      message: `Status tidak valid. Pilihan: ${ALLOWED_STATUS.join(', ')}`
    });
  }

  const db = getDb();
  db.get('SELECT cs_id FROM repeat_orders WHERE contract_no = ?', [contractNo], (err, row) => {
    if (err) {
      console.error('RO update lookup error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca data.' });
    }

    if (!row) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Data Repeat Order tidak ditemukan.' });
    }

    if (!canSeeRow(user, row.cs_id)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Anda tidak berhak mengubah data kontrak ini.'
      });
    }

    db.run(
      `UPDATE repeat_orders
       SET status_followup = COALESCE(?, status_followup),
           catatan = COALESCE(?, catatan),
           updated_at = datetime('now')
       WHERE contract_no = ?`,
      [
        statusFollowup ? String(statusFollowup).toUpperCase() : null,
        catatan != null ? String(catatan).trim() : null,
        contractNo
      ],
      function (updateErr) {
        if (updateErr) {
          console.error('RO update error:', updateErr.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menyimpan perubahan.' });
        }

        db.get('SELECT * FROM repeat_orders WHERE contract_no = ?', [contractNo], (e2, updated) => {
          if (e2) return res.json({ success: true, message: 'Perubahan tersimpan.' });
          res.json({ success: true, message: 'Perubahan tersimpan.', data: mapRow(updated) });
        });
      }
    );
  });
};

/**
 * Ringkasan follow-up RO.
 * GET /api/v1/repeat-order/stats/summary
 */
exports.getROStats = (req, res) => {
  const user = req.user;
  let where = ' WHERE 1=1';
  const params = [];

  const own = ownershipClause(user);
  where += own.sql;
  params.push(...own.params);

  const db = getDb();
  db.all(
    `SELECT status_followup, COUNT(*) AS jumlah FROM repeat_orders${where} GROUP BY status_followup ORDER BY jumlah DESC`,
    params,
    (err, rows) => {
      if (err) {
        console.error('RO stats error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca statistik.' });
      }

      const total = (rows || []).reduce((s, r) => s + r.jumlah, 0);

      res.json({
        success: true,
        data: {
          total,
          breakdown: (rows || []).map((r) => ({
            status: r.status_followup || '(kosong)',
            jumlah: r.jumlah,
            persen: total ? Number(((r.jumlah / total) * 100).toFixed(2)) : 0
          }))
        }
      });
    }
  );
};
