const { getDb } = require('../db/database');

/** Skema yang dikenal app. */
const SKEMA = ['REGULER', 'AWDA'];

const normalisasiSkema = (v) => {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return SKEMA.includes(s) ? s : null;
};

const mapRow = (r) => {
  let angsuran = {};
  try {
    angsuran = JSON.parse(r.angsuran || '{}');
  } catch (_) {
    angsuran = {};
  }
  return {
    skema: r.skema,
    danaCair: r.dana_cair,
    angsuran,
  };
};

/**
 * Cari price list berdasarkan nominal pinjaman.
 *
 * Perilaku pencarian (sengaja toleran, karena marketing mengetik
 * nominal dari kepala nasabah):
 *  - `nominal` persis ada        -> satu baris itu
 *  - tidak persis               -> baris terdekat di bawah DAN di atas,
 *                                  supaya marketing bisa menawarkan
 *                                  pilihan yang menguntungkan
 *  - `q` (teks bebas)           -> filter berdasarkan digit nominal
 *
 * GET /api/v1/pricelist?skema=REGULER&nominal=15000000
 * GET /api/v1/pricelist?skema=AWDA&q=15
 */
exports.cariPriceList = (req, res) => {
  const skema = normalisasiSkema(req.query.skema);
  const nominalRaw = String(req.query.nominal == null ? '' : req.query.nominal)
    .replace(/[^0-9]/g, '');
  const q = String(req.query.q == null ? '' : req.query.q).trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 300);

  const db = getDb();

  const kirim = (data, info) =>
    res.json({ success: true, data: { skema, ...info, items: data } });

  // --- 1. Nominal persis ---
  if (nominalRaw) {
    const nominal = parseInt(nominalRaw, 10);

    const sql = skema
      ? 'SELECT * FROM pricelist_angsuran WHERE skema = ? AND dana_cair = ?'
      : 'SELECT * FROM pricelist_angsuran WHERE dana_cair = ?';
    const params = skema ? [skema, nominal] : [nominal];

    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Pricelist cari error:', err.message);
        return res.status(500).json({
          success: false, code: 'DB_ERROR', message: 'Gagal mencari price list.',
        });
      }

      if (rows && rows.length > 0) {
        return kirim(rows.map(mapRow), { cocokPersis: true, nominal });
      }

      // --- 2. Tidak persis: ambil tetangga terdekat ---
      const sqlBawah = skema
        ? `SELECT * FROM pricelist_angsuran WHERE skema = ? AND dana_cair < ?
           ORDER BY dana_cair DESC LIMIT 1`
        : `SELECT * FROM pricelist_angsuran WHERE dana_cair < ?
           ORDER BY dana_cair DESC LIMIT 1`;
      const sqlAtas = skema
        ? `SELECT * FROM pricelist_angsuran WHERE skema = ? AND dana_cair > ?
           ORDER BY dana_cair ASC LIMIT 1`
        : `SELECT * FROM pricelist_angsuran WHERE dana_cair > ?
           ORDER BY dana_cair ASC LIMIT 1`;

      const pBawah = skema ? [skema, nominal] : [nominal];
      const pAtas = skema ? [skema, nominal] : [nominal];

      db.all(sqlBawah, pBawah, (e1, bawah) => {
        if (e1) {
          return res.status(500).json({
            success: false, code: 'DB_ERROR', message: 'Gagal mencari price list.',
          });
        }
        db.all(sqlAtas, pAtas, (e2, atas) => {
          if (e2) {
            return res.status(500).json({
              success: false, code: 'DB_ERROR', message: 'Gagal mencari price list.',
            });
          }
          const gabung = [...(bawah || []), ...(atas || [])];
          return kirim(gabung.map(mapRow), {
            cocokPersis: false,
            nominal,
            pesan:
              gabung.length > 0
                ? 'Nominal tidak ada di price list. Ini pilihan terdekat.'
                : 'Nominal di luar rentang price list.',
          });
        });
      });
    });
    return;
  }

  // --- 3. Pencarian teks bebas ---
  let where = ' WHERE 1=1';
  const params = [];
  if (skema) {
    where += ' AND skema = ?';
    params.push(skema);
  }
  if (q) {
    const digit = q.replace(/[^0-9]/g, '');
    if (digit) {
      where += ' AND CAST(dana_cair AS TEXT) LIKE ?';
      params.push(`%${digit}%`);
    }
  }

  db.all(
    `SELECT * FROM pricelist_angsuran${where} ORDER BY dana_cair ASC LIMIT ?`,
    [...params, limit],
    (err, rows) => {
      if (err) {
        console.error('Pricelist list error:', err.message);
        return res.status(500).json({
          success: false, code: 'DB_ERROR', message: 'Gagal membaca price list.',
        });
      }
      kirim((rows || []).map(mapRow), { cocokPersis: false });
    }
  );
};

/**
 * Info rentang & tenor tiap skema, dipakai app untuk mengisi batas
 * pencarian dan label tenor.
 *
 * GET /api/v1/pricelist/info
 */
exports.infoPriceList = (req, res) => {
  const db = getDb();

  db.all(
    `SELECT skema, COUNT(*) AS jumlah, MIN(dana_cair) AS min, MAX(dana_cair) AS max,
            MIN(angsuran) AS contoh
       FROM pricelist_angsuran GROUP BY skema`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({
          success: false, code: 'DB_ERROR', message: 'Gagal membaca info price list.',
        });
      }

      // Tenor diambil dari baris pertama tiap skema (semua baris sama).
      const hasil = {};
      let sisa = (rows || []).length;

      if (sisa === 0) {
        return res.json({ success: true, data: {} });
      }

      rows.forEach((r) => {
        db.get(
          'SELECT angsuran FROM pricelist_angsuran WHERE skema = ? LIMIT 1',
          [r.skema],
          (e2, satu) => {
            let tenor = [];
            if (!e2 && satu) {
              try {
                tenor = Object.keys(JSON.parse(satu.angsuran || '{}'))
                  .map((k) => parseInt(k, 10))
                  .filter((n) => Number.isFinite(n))
                  .sort((a, b) => a - b);
              } catch (_) {}
            }
            hasil[r.skema] = {
              jumlah: r.jumlah,
              min: r.min,
              max: r.max,
              tenor,
            };
            if (--sisa === 0) {
              res.json({ success: true, data: hasil });
            }
          }
        );
      });
    }
  );
};
