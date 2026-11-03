const { getDb } = require('../db/database');

const normContract = (v) => String(v == null ? '' : v).replace(/[^0-9]/g, '');

/**
 * Cek CLOP berdasarkan nomor kontrak.
 * GET /api/v1/clop/check/:contractNo
 */
exports.checkClop = (req, res) => {
  const contractNo = normContract(req.params.contractNo);

  if (!contractNo || contractNo.length < 6) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_CONTRACT',
      message: 'Nomor kontrak tidak valid. Minimal 6 digit angka.'
    });
  }

  const db = getDb();
  db.get(
    'SELECT contract_no, cycle_awal, trend_cycle FROM clop_contracts WHERE contract_no = ?',
    [contractNo],
    (err, row) => {
      if (err) {
        console.error('CLOP query error:', err.message);
        return res.status(500).json({
          success: false,
          code: 'DB_ERROR',
          message: 'Gagal membaca data CLOP.'
        });
      }

      if (!row) {
        return res.json({
          success: true,
          found: false,
          contractNo,
          message: 'Kontrak tidak terdaftar dalam CLOP HO.'
        });
      }

      // Trend cycle menentukan kelayakan: ABADI = tidak pernah CLOP
      const isAbadi = String(row.trend_cycle || '').toUpperCase() === 'ABADI';

      res.json({
        success: true,
        found: true,
        data: {
          contractNo: row.contract_no,
          cycleAwal: row.cycle_awal,
          trendCycle: row.trend_cycle,
          isAbadi,
          eligible: isAbadi
        }
      });
    }
  );
};

/**
 * Pencarian CLOP dengan pagination.
 * GET /api/v1/clop/search?q=&trend=&limit=&offset=
 */
exports.searchClop = (req, res) => {
  const { q, trend, limit = 50, offset = 0 } = req.query;

  const lim = Math.min(parseInt(limit, 10) || 50, 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const db = getDb();
  let where = ' WHERE 1=1';
  const params = [];

  if (q) {
    const term = normContract(q) || String(q).trim();
    where += ' AND contract_no LIKE ?';
    params.push(`%${term}%`);
  }
  if (trend) {
    where += ' AND UPPER(trend_cycle) = ?';
    params.push(String(trend).trim().toUpperCase());
  }

  db.get(`SELECT COUNT(*) AS total FROM clop_contracts${where}`, params, (err, countRow) => {
    if (err) {
      console.error('CLOP count error:', err.message);
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menghitung data CLOP.' });
    }

    const total = countRow ? countRow.total : 0;

    db.all(
      `SELECT contract_no, cycle_awal, trend_cycle FROM clop_contracts${where} ORDER BY contract_no LIMIT ? OFFSET ?`,
      [...params, lim, off],
      (err2, rows) => {
        if (err2) {
          console.error('CLOP search error:', err2.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal mencari data CLOP.' });
        }

        res.json({
          success: true,
          data: (rows || []).map((r) => ({
            contractNo: r.contract_no,
            cycleAwal: r.cycle_awal,
            trendCycle: r.trend_cycle
          })),
          pagination: { total, limit: lim, offset: off, returned: (rows || []).length }
        });
      }
    );
  });
};

/**
 * Ringkasan distribusi trend cycle.
 * GET /api/v1/clop/stats
 */
exports.getClopStats = (req, res) => {
  const db = getDb();
  db.all(
    `SELECT trend_cycle, COUNT(*) AS jumlah FROM clop_contracts GROUP BY trend_cycle ORDER BY jumlah DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('CLOP stats error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal membaca statistik CLOP.' });
      }

      const total = (rows || []).reduce((sum, r) => sum + r.jumlah, 0);

      res.json({
        success: true,
        data: {
          total,
          breakdown: (rows || []).map((r) => ({
            trendCycle: r.trend_cycle || '(kosong)',
            jumlah: r.jumlah,
            persen: total ? Number(((r.jumlah / total) * 100).toFixed(2)) : 0
          }))
        }
      });
    }
  );
};
