const { getDb } = require('../db/database');

/**
 * Multi-keyword OTR search.
 *
 * Setiap kata di `q` dicocokkan ke SEMUA kolom teks sekaligus
 * (brand, model, object_type, object_description, group_type_unit, vehicle, tahun).
 * Semua kata harus cocok (AND) — jadi "honda beat 2020" menyempit,
 * bukan melebar seperti pencarian OR biasa.
 */
const SEARCH_COLUMNS = [
  'brand',
  'model',
  'object_type',
  'object_description',
  'group_type_unit',
  'vehicle',
  'CAST(tahun AS TEXT)',
];

function buildWhere(q, brand, tahunMin, tahunMax) {
  const clauses = [];
  const params = [];

  const words = String(q || '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 8); // batasi supaya query tidak meledak

  for (const w of words) {
    const like = `%${w}%`;
    const ors = SEARCH_COLUMNS.map((c) => `${c} LIKE ?`).join(' OR ');
    clauses.push(`(${ors})`);
    for (let i = 0; i < SEARCH_COLUMNS.length; i++) params.push(like);
  }

  if (brand) {
    clauses.push('brand = ?');
    params.push(String(brand).trim());
  }
  if (tahunMin) {
    clauses.push('tahun >= ?');
    params.push(parseInt(tahunMin, 10));
  }
  if (tahunMax) {
    clauses.push('tahun <= ?');
    params.push(parseInt(tahunMax, 10));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

/**
 * GET /api/v1/otr/search-all?q=&brand=&tahunMin=&tahunMax=&limit=&offset=
 * Pencarian bebas: tidak wajib isi filter apa pun.
 */
exports.searchAll = (req, res) => {
  try {
    const { q = '', brand = '', tahunMin = '', tahunMax = '', limit = 30, offset = 0 } = req.query;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const { where, params } = buildWhere(q, brand, tahunMin, tahunMax);
    const db = getDb();

    db.get(`SELECT COUNT(*) AS total FROM otr_prices ${where}`, params, (err, countRow) => {
      if (err) {
        console.error('OTR count error:', err.message);
        return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal menghitung data OTR.' });
      }

      const total = countRow?.total || 0;
      const sql = `SELECT * FROM otr_prices ${where} ORDER BY brand, model, tahun DESC LIMIT ? OFFSET ?`;

      db.all(sql, [...params, lim, off], (err2, rows) => {
        if (err2) {
          console.error('OTR search error:', err2.message);
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Gagal mencari data OTR.' });
        }

        res.json({
          success: true,
          data: rows || [],
          pagination: { total, limit: lim, offset: off, returned: (rows || []).length },
        });
      });
    });
  } catch (err) {
    console.error('OTR searchAll error:', err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
};

/**
 * GET /api/v1/otr/stats
 * Ringkasan untuk halaman pencarian.
 */
exports.getStats = (req, res) => {
  try {
    const db = getDb();
    db.get(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT brand) AS brands,
              MIN(tahun) AS tahunMin,
              MAX(tahun) AS tahunMax
       FROM otr_prices`,
      [],
      (err, row) => {
        if (err) {
          return res.status(500).json({ success: false, code: 'DB_ERROR', message: err.message });
        }
        res.json({
          success: true,
          data: {
            total: row?.total || 0,
            brands: row?.brands || 0,
            tahunMin: row?.tahunMin || null,
            tahunMax: row?.tahunMax || null,
          },
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
};

/**
 * GET /api/v1/otr/suggest?q=...
 * Saran kata kunci dari brand + model yang cocok (untuk autocomplete).
 */
exports.suggest = (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });

    const like = `%${q}%`;
    const db = getDb();
    db.all(
      `SELECT DISTINCT brand || ' ' || model AS label, brand, model
       FROM otr_prices
       WHERE brand LIKE ? OR model LIKE ? OR group_type_unit LIKE ?
       ORDER BY brand, model
       LIMIT 12`,
      [like, like, like],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows || [] });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
};
