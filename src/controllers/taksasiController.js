const {
  hitungTaksasi,
  bandingkanTenor,
  lookupAngsuran,
  getRateTable,
  getTenorOptions,
  hitungPersenTaksasi,
  getCustomerProfile,
  KONSTANTA,
  MATRIKS_CUSTOMER
} = require('../services/taksasiCalculator');
const { getDb } = require('../db/database');

const VALID_TIPE = ['New Customer', 'Repeat Order', 'Kaleng Hidup'];
const VALID_CORI = ['Good Loyal', 'Good', 'Medium'];
const VALID_MERK = ['Honda', 'Non Honda'];
const VALID_TENOR = [6, 8, 12, 16, 18, 24, 36];

const badRequest = (res, code, message, extra) =>
  res.status(400).json({ success: false, code, message, ...(extra || {}) });

/**
 * POST /api/v1/taksasi/hitung
 * Hitung taksasi lengkap.
 */
exports.hitung = (req, res) => {
  const b = req.body || {};

  const otr = Number(b.otr);
  if (!Number.isFinite(otr) || otr <= 0) {
    return badRequest(res, 'INVALID_OTR', 'OTR wajib diisi dan lebih besar dari 0.');
  }

  const tipeCustomer = b.tipeCustomer || 'New Customer';
  if (!VALID_TIPE.includes(tipeCustomer)) {
    return badRequest(res, 'INVALID_TIPE_CUSTOMER', `Tipe customer harus salah satu: ${VALID_TIPE.join(', ')}`);
  }

  const cori = b.cori || 'Good';
  if (!VALID_CORI.includes(cori)) {
    return badRequest(res, 'INVALID_CORI', `CORI harus salah satu: ${VALID_CORI.join(', ')}`);
  }

  const merkMotor = b.merkMotor || 'Honda';
  if (!VALID_MERK.includes(merkMotor)) {
    return badRequest(res, 'INVALID_MERK', `Merk motor harus salah satu: ${VALID_MERK.join(', ')}`);
  }

  const tenor = Number(b.tenor) || 12;
  if (!VALID_TENOR.includes(tenor)) {
    return badRequest(res, 'INVALID_TENOR', `Tenor harus salah satu: ${VALID_TENOR.join(', ')}`);
  }

  const lamaPajakMati = Number(b.lamaPajakMati) || 0;
  if (lamaPajakMati < 0 || lamaPajakMati > 8) {
    return badRequest(res, 'INVALID_PAJAK_MATI', 'Lama pajak mati harus 0-8 tahun.');
  }

  const tahunMotor = b.tahunMotor ? Number(b.tahunMotor) : '';
  if (tahunMotor !== '' && (tahunMotor < 1900 || tahunMotor > new Date().getFullYear() + 1)) {
    return badRequest(res, 'INVALID_TAHUN_MOTOR', 'Tahun motor tidak valid.');
  }

  // Tenor harus tersedia untuk tahun motor ini
  if (tahunMotor !== '') {
    const allowed = getTenorOptions(tahunMotor);
    if (!allowed.includes(tenor)) {
      return badRequest(
        res,
        'TENOR_TIDAK_TERSEDIA',
        `Tenor ${tenor} bulan tidak tersedia untuk motor tahun ${tahunMotor}. Pilihan: ${allowed.join(', ')}`,
        { tenorOptions: allowed }
      );
    }
  }

  try {
    const result = hitungTaksasi({
      otr,
      tipeCustomer,
      cori,
      merkMotor,
      segaris: b.segaris !== false,
      lamaPajakMati,
      kalengMati: !!b.kalengMati,
      fakturAda: b.fakturAda !== false,
      tenor,
      meteraiCount: Number(b.meteraiCount) || 0,
      topUp: !!b.topUp,
      sisaAngsuran: Number(b.sisaAngsuran) || 0,
      denda: Number(b.denda) || 0,
      dendaTerbayar: Number(b.dendaTerbayar) || 0,
      collFee: Number(b.collFee) || 0,
      collFeeTerbayar: Number(b.collFeeTerbayar) || 0,
      km: b.km === 0 ? '' : b.km || '',
      tahunMotor,
      plafondOverride: Number(b.plafondOverride) || 0
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Taksasi error:', err.message);
    res.status(500).json({ success: false, code: 'CALC_ERROR', message: 'Gagal menghitung taksasi.' });
  }
};

/**
 * POST /api/v1/taksasi/bandingkan-tenor
 * Angsuran untuk setiap tenor yang tersedia.
 */
exports.bandingkan = (req, res) => {
  const b = req.body || {};

  const otr = Number(b.otr);
  if (!Number.isFinite(otr) || otr <= 0) {
    return badRequest(res, 'INVALID_OTR', 'OTR wajib diisi dan lebih besar dari 0.');
  }

  try {
    const result = bandingkanTenor({
      otr,
      tipeCustomer: b.tipeCustomer || 'New Customer',
      cori: b.cori || 'Good',
      merkMotor: b.merkMotor || 'Honda',
      segaris: b.segaris !== false,
      lamaPajakMati: Number(b.lamaPajakMati) || 0,
      kalengMati: !!b.kalengMati,
      fakturAda: b.fakturAda !== false,
      meteraiCount: Number(b.meteraiCount) || 0,
      km: b.km === 0 ? '' : b.km || '',
      tahunMotor: b.tahunMotor ? Number(b.tahunMotor) : '',
      plafondOverride: Number(b.plafondOverride) || 0
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Bandingkan tenor error:', err.message);
    res.status(500).json({ success: false, code: 'CALC_ERROR', message: 'Gagal menghitung perbandingan tenor.' });
  }
};

/**
 * GET /api/v1/taksasi/angsuran?plafond=&tenor=&tipe=
 * Lookup angsuran tunggal.
 */
exports.angsuran = (req, res) => {
  const plafond = Number(req.query.plafond);
  const tenor = Number(req.query.tenor) || 12;
  const tipe = req.query.tipe || 'Reguler';

  if (!Number.isFinite(plafond) || plafond <= 0) {
    return badRequest(res, 'INVALID_PLAFOND', 'Plafond wajib diisi dan lebih besar dari 0.');
  }
  if (!['Reguler', 'Awda'].includes(tipe)) {
    return badRequest(res, 'INVALID_TIPE_ANGSURAN', 'Tipe angsuran harus Reguler atau Awda.');
  }
  if (!VALID_TENOR.includes(tenor)) {
    return badRequest(res, 'INVALID_TENOR', `Tenor harus salah satu: ${VALID_TENOR.join(', ')}`);
  }

  const { min, max } = getRateTable(tipe);
  const angsuran = lookupAngsuran(plafond, tenor, tipe);

  res.json({
    success: true,
    data: {
      plafond,
      tenor,
      angsuranType: tipe,
      angsuran,
      plafondEfektif: Math.max(min, Math.min(max, plafond)),
      tabelRange: { min, max }
    }
  });
};

/**
 * GET /api/v1/taksasi/persen-taksasi?km=&tahunMotor=
 */
exports.persenTaksasi = (req, res) => {
  const km = req.query.km;
  const tahunMotor = req.query.tahunMotor;

  if (!tahunMotor) {
    return badRequest(res, 'INVALID_TAHUN_MOTOR', 'tahunMotor wajib diisi.');
  }

  const persen = hitungPersenTaksasi(km, Number(tahunMotor));

  res.json({
    success: true,
    data: {
      km: km || 0,
      tahunMotor: Number(tahunMotor),
      umurKendaraan: Math.max(1, new Date().getFullYear() - Number(tahunMotor)),
      persenTaksasi: persen,
      persenTaksasiPct: Number((persen * 100).toFixed(4))
    }
  });
};

/**
 * GET /api/v1/taksasi/config
 * Semua konstanta, matriks customer, dan pilihan tenor — untuk app mobile.
 */
exports.config = (req, res) => {
  res.json({
    success: true,
    data: {
      konstanta: {
        adminMurni: KONSTANTA.adminMurni,
        warNettEff: KONSTANTA.warNettEff,
        potongan: KONSTANTA.potongan,
        pajakMatiTier: KONSTANTA.pajakMatiTier,
        meteraiPerLembar: KONSTANTA.meteraiPerLembar,
        plafondMin: KONSTANTA.plafondMin,
        plafondStep: KONSTANTA.plafondStep,
        biayaTopUp: KONSTANTA.biayaTopUp,
        tenorTersedia: KONSTANTA.tenors
      },
      matriksCustomer: Object.entries(MATRIKS_CUSTOMER).map(([key, val]) => {
        const [tipeCustomer, merkMotor, posisiBpkb] = key.split('|');
        return { tipeCustomer, merkMotor, posisiBpkb, ...val };
      }),
      pilihan: {
        tipeCustomer: VALID_TIPE,
        cori: VALID_CORI,
        merkMotor: VALID_MERK,
        tenor: VALID_TENOR
      }
    }
  });
};

/**
 * GET /api/v1/taksasi/tenor-options?tahunMotor=
 */
exports.tenorOptions = (req, res) => {
  const tahunMotor = req.query.tahunMotor ? Number(req.query.tahunMotor) : '';
  const options = getTenorOptions(tahunMotor);

  res.json({
    success: true,
    data: {
      tahunMotor: tahunMotor || null,
      tenorOptions: options,
      catatan: tahunMotor
        ? 'Tenor dibatasi 36 bulan dikurangi umur kendaraan, minimal 6 bulan.'
        : 'Tanpa tahun motor, semua tenor tersedia (default maks 24 bulan untuk perhitungan).'
    }
  });
};

/**
 * POST /api/v1/taksasi/simpan
 * Simpan hasil taksasi ke riwayat (dipanggil dari tombol "Simpan" di app).
 */
exports.simpan = (req, res) => {
  try {
    const {
      customerName = '',
      contractNo = '',
      brand = '',
      model = '',
      tahun = null,
      tahunMotor = null,
      km = null,
      otr = 0,
      tenor = 12,
      plafond = 0,
      angsuran = 0,
      terimaBersih = 0,
      payload = null,
    } = req.body || {};

    const csId = req.user?.csId || req.user?.cs_id || '';
    const db = getDb();

    db.run(
      `INSERT INTO taksasi_history
        (cs_id, customer_name, contract_no, brand, model, tahun, tahun_motor, km,
         otr, tenor, plafond, angsuran, terima_bersih, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        csId,
        String(customerName || ''),
        String(contractNo || ''),
        String(brand || ''),
        String(model || ''),
        tahun ? Number(tahun) : null,
        tahunMotor ? Number(tahunMotor) : null,
        km ? Number(km) : null,
        Math.round(Number(otr) || 0),
        Number(tenor) || 12,
        Math.round(Number(plafond) || 0),
        Math.round(Number(angsuran) || 0),
        Math.round(Number(terimaBersih) || 0),
        payload ? JSON.stringify(payload) : null,
      ],
      function (err) {
        if (err) {
          console.error('Simpan taksasi error:', err.message);
          return res.status(500).json({
            success: false,
            code: 'DB_ERROR',
            message: 'Gagal menyimpan hasil taksasi.',
          });
        }
        res.json({
          success: true,
          data: { id: this.lastID },
          message: 'Hasil taksasi tersimpan.',
        });
      }
    );
  } catch (err) {
    console.error('Simpan taksasi error:', err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
};

/**
 * GET /api/v1/taksasi/riwayat?limit=&offset=
 */
exports.riwayat = (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const csId = req.user?.csId || req.user?.cs_id || '';
    const db = getDb();

    db.all(
      `SELECT * FROM taksasi_history
       WHERE (? = '' OR cs_id = ?)
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [csId, csId, limit, offset],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, data: rows || [] });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: err.message });
  }
};
