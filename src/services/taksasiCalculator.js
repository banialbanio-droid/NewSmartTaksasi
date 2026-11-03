/**
 * SMART TAKSASI V3.2 — Mesin kalkulasi taksasi.
 *
 * Port 1:1 dari index.html (sumber otoritatif):
 *   Yo   -> KONSTANTA
 *   OSe  -> DEPRESIASI (matriks KM x umur)
 *   DSe  -> MATRIKS_CUSTOMER
 *   ISe  -> TENOR_INDEX
 *   PSe/YK -> getRateTable() / lookupAngsuran()
 *   JK   -> getCustomerProfile()
 *   cM   -> hitungPotonganPajak()
 *   QSe  -> hitungPersenTaksasi()
 *   MSe  -> hitungRisk()
 *   LSe  -> buildPlafondOptions()
 *   HSe  -> hitungTaksasi()
 *
 * JANGAN ubah angka di file ini tanpa memverifikasi ulang ke index.html.
 */

const path = require('path');
const fs = require('fs');

const KONSTANTA = {
  tenors: [6, 8, 12, 16, 24, 36],
  adminMurni: 610000,
  warNettEff: { Reguler: 0.54, Awda: 0.65 },
  potongan: { kalengMati: 470000, fakturTidakAda: 500000 },
  pajakMatiTier: [350000, 650000, 950000, 1250000, 1550000, 1850000, 2150000, 2450000],
  meteraiPerLembar: 10000,
  plafondMin: 3250000,
  plafondStep: 250000,
  biayaTopUp: 5000
};

// Matriks depresiasi: key = umur kendaraan (tahun, 1..10; >6 dianggap 10)
// pwajar = KM wajar, factors = faktor pengali per selisih KM
const DEPRESIASI = {
  1: { pwajar: 10000, factors: [1, 0.9848, 0.983075, 0.981775, 0.9610375, 0.9262375, 0.8914375] },
  2: { pwajar: 20000, factors: [1, 0.9846, 0.9799, 0.977525, 0.9485, 0.9137, 0.8789] },
  3: { pwajar: 30000, factors: [1, 0.9833, 0.9761, 0.9786, 0.9272625, 0.8924625, 0.8576625] },
  4: { pwajar: 40000, factors: [1, 0.9833, 0.9761, 0.9689, 0.90655, 0.87175, 0.83695] },
  5: { pwajar: 50000, factors: [1, 0.9831, 0.9759, 0.9687, 0.90635, 0.87155, 0.83675] },
  6: { pwajar: 60000, factors: [1, 0.9829, 0.9757, 0.9683, 0.90185, 0.86705, 0.83225] },
  7: { pwajar: 70000, factors: [1, 0.98265, 0.972775, 0.9629, 0.89645, 0.86165, 0.82685] },
  8: { pwajar: 70000, factors: [1, 0.9824, 0.9647, 0.947, 0.88055, 0.84575, 0.81095] },
  9: { pwajar: 70000, factors: [1, 0.98215, 0.9647, 0.9311, 0.86465, 0.82985, 0.79505] },
  10: { pwajar: 70000, factors: [1, 0.9819, 0.96445, 0.9152, 0.84875, 0.81395, 0.77915] }
};

// Matriks tipe customer x merk x segaris -> jenis angsuran + rasio plafond
const MATRIKS_CUSTOMER = {
  'New Customer|Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.70 },
  'New Customer|Honda|Tidak Segaris': { angsuranType: 'Awda', ratio: 0.60 },
  'New Customer|Non Honda|Segaris': { angsuranType: 'Awda', ratio: 0.55 },
  'New Customer|Non Honda|Tidak Segaris': { angsuranType: 'Awda', ratio: 0.50 },
  'Good Loyal|Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.85 },
  'Good Loyal|Honda|Tidak Segaris': { angsuranType: 'Reguler', ratio: 0.85 },
  'Good Loyal|Non Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.85 },
  'Good Loyal|Non Honda|Tidak Segaris': { angsuranType: 'Reguler', ratio: 0.85 },
  'Good|Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.80 },
  'Good|Honda|Tidak Segaris': { angsuranType: 'Reguler', ratio: 0.80 },
  'Good|Non Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.80 },
  'Good|Non Honda|Tidak Segaris': { angsuranType: 'Reguler', ratio: 0.80 },
  'Medium|Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.75 },
  'Medium|Honda|Tidak Segaris': { angsuranType: 'Reguler', ratio: 0.75 },
  'Medium|Non Honda|Segaris': { angsuranType: 'Reguler', ratio: 0.75 },
  'Medium|Non Honda|Tidak Segaris': { angsuranType: 'Awda', ratio: 0.75 }
};

// Tenor -> index kolom di tabel rate
const TENOR_INDEX = { 6: 0, 8: 1, 12: 2, 16: 3, 18: 3, 24: 4, 36: 5 };

// ---------------------------------------------------------------- rate tables
let _reguler = null;
let _awda = null;

function loadRateTables() {
  if (_reguler && _awda) return { reguler: _reguler, awda: _awda };
  const dir = path.join(__dirname, '..', '..', 'data');
  const rPath = path.join(dir, 'rate-reguler.json');
  const aPath = path.join(dir, 'rate-awda.json');

  if (!fs.existsSync(rPath) || !fs.existsSync(aPath)) {
    throw new Error(
      'Tabel rate belum ada. Jalankan: node scripts/extract-tables.js'
    );
  }
  _reguler = JSON.parse(fs.readFileSync(rPath, 'utf-8'));
  _awda = JSON.parse(fs.readFileSync(aPath, 'utf-8'));
  return { reguler: _reguler, awda: _awda };
}

function getRateTable(angsuranType) {
  const { reguler, awda } = loadRateTables();
  const table = angsuranType === 'Awda' ? awda : reguler;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  return { min: keys[0], max: keys[keys.length - 1], table, keys };
}

/**
 * Lookup angsuran dari tabel rate.
 * Plafond di-clamp ke [min, max] lalu dibulatkan KE BAWAH ke kelipatan 250.000.
 */
function lookupAngsuran(plafond, tenor, angsuranType) {
  const { min, max, table } = getRateTable(angsuranType);
  const colIdx = TENOR_INDEX[tenor];
  if (colIdx === undefined) return 0;
  const clamped = Math.max(min, Math.min(max, Number(plafond) || 0));
  const rounded = Math.floor(clamped / KONSTANTA.plafondStep) * KONSTANTA.plafondStep;
  const row = table[String(rounded)];
  return row ? row[colIdx] : 0;
}

// ------------------------------------------------------------- customer & pajak
function getCustomerProfile(tipeCustomer, cori, merkMotor, isSegaris) {
  const keyCust = tipeCustomer === 'New Customer' ? 'New Customer' : cori;
  const key = `${keyCust}|${merkMotor}|${isSegaris ? 'Segaris' : 'Tidak Segaris'}`;
  const conf = MATRIKS_CUSTOMER[key] || { angsuranType: 'Reguler', ratio: 0.9 };
  return { angsuranType: conf.angsuranType, ratio: conf.ratio };
}

/**
 * Potongan pajak mati bertingkat per tahun.
 * 0 tahun -> 0; 1 thn -> 350.000; 8+ thn -> 2.450.000
 */
function hitungPotonganPajak(lamaPajakMati) {
  if (!lamaPajakMati || lamaPajakMati <= 0) return 0;
  const idx = Math.min(Math.floor(lamaPajakMati), KONSTANTA.pajakMatiTier.length) - 1;
  return KONSTANTA.pajakMatiTier[idx];
}

/**
 * Batas tenor maksimum berdasarkan tahun motor.
 * 36 - (tahun sekarang - tahun motor), dijepit ke [6, 36].
 */
function getMaxTenor(tahunMotor, refYear) {
  if (!tahunMotor) return 24;
  const curY = Number(refYear) || new Date().getFullYear();
  const r = 36 - (curY - Number(tahunMotor));
  return Math.max(6, Math.min(36, r));
}

function getTenorOptions(tahunMotor, refYear) {
  const maxT = getMaxTenor(tahunMotor, refYear);
  return KONSTANTA.tenors.filter((t) => t <= maxT);
}

/**
 * % taksasi dari KM + tahun motor (matriks depresiasi).
 * KM kosong / 0 / tidak valid -> 1 (100%, depresiasi tidak berlaku).
 */
function hitungPersenTaksasi(km, tahunMotor, refYear) {
  const kM = Number(km);
  if (!km || isNaN(kM) || kM <= 0) return 1;
  if (!tahunMotor) return 1;

  const curY = Number(refYear) || new Date().getFullYear();
  const tM = Number(tahunMotor);
  if (!tM || tM < 1900) return 1;

  let umur = curY - tM;
  if (umur < 1) umur = 1;
  const bucket = umur > 6 ? 10 : umur;

  const cfg = DEPRESIASI[bucket];
  if (!cfg) return 1;

  const selisih = kM - cfg.pwajar;
  let factorIdx;
  if (selisih <= 0) factorIdx = 0;
  else if (selisih <= 10000) factorIdx = 1;
  else if (selisih <= 20000) factorIdx = 2;
  else if (selisih <= 30000) factorIdx = 3;
  else if (selisih <= 40000) factorIdx = 4;
  else if (selisih <= 50000) factorIdx = 5;
  else factorIdx = 6;

  return cfg.factors[factorIdx];
}

/**
 * Risk grade. Hanya CORI Medium yang bisa > LOW.
 */
function hitungRisk(cori, merkMotor, namaBpkb, tahunMotor, km, refYear) {
  if (!tahunMotor || !km) return '-';
  const curY = Number(refYear) || new Date().getFullYear();
  const tM = Number(tahunMotor);
  const kM = Number(km);
  if (!tM || tM < 1900) return '-';

  const umur = curY - tM;
  if (umur < 1) return '-';

  const coriUpper =
    cori === 'Medium' ? 'MEDIUM' : cori === 'Good Loyal' ? 'GOOD LOYAL' : cori === 'Good' ? 'GOOD' : null;
  if (coriUpper !== 'MEDIUM') return 'LOW';

  const merk = merkMotor === 'Honda' ? 'HONDA' : 'NON HONDA';
  const bpkb = namaBpkb === 'Different' ? 'DIFFERENT' : 'SAME';

  if (kM > 140000 || (merk === 'NON HONDA' && bpkb === 'DIFFERENT')) return 'HIGH';
  if (umur > 6) return 'MEDIUM';

  const batas = bpkb === 'SAME' && merk === 'HONDA' ? 60000 : 40000;
  return kM <= batas ? 'LOW' : 'MEDIUM';
}

/**
 * Opsi plafond bertingkat: maksimum lalu turun 500.000 sampai 3.250.000 (maks 12 opsi).
 */
function buildPlafondOptions(otrEfektif, ratio) {
  const maxPlafond = Math.max(
    KONSTANTA.plafondMin,
    Math.floor((otrEfektif * ratio) / KONSTANTA.plafondStep) * KONSTANTA.plafondStep
  );
  const list = [{ pinjaman: maxPlafond, plafondPct: ratio }];

  let step = maxPlafond - 500000;
  while (step >= KONSTANTA.plafondMin && list.length < 12) {
    list.push({
      pinjaman: step,
      plafondPct: otrEfektif > 0 ? step / otrEfektif : 0
    });
    step -= 500000;
  }
  return list;
}

// ------------------------------------------------------------------- main calc
/**
 * Hitung taksasi lengkap.
 * @param {object} input
 * @returns {object} rincian perhitungan
 */
function hitungTaksasi(input) {
  const {
    otr = 0,
    tipeCustomer = 'New Customer',
    cori = 'Good',
    merkMotor = 'Honda',
    segaris = true,
    lamaPajakMati = 0,
    kalengMati = false,
    fakturAda = true,
    tenor = 12,
    meteraiCount = 0,
    topUp = false,
    sisaAngsuran = 0,
    denda = 0,
    dendaTerbayar = 0,
    collFee = 0,
    collFeeTerbayar = 0,
    km = '',
    tahunMotor = '',
    plafondOverride = 0,
    refYear
  } = input;

  const otrNum = Number(otr) || 0;

  // 1. Total potongan
  let totalPotongan = hitungPotonganPajak(Number(lamaPajakMati));
  if (kalengMati) totalPotongan += KONSTANTA.potongan.kalengMati;
  if (!fakturAda) totalPotongan += KONSTANTA.potongan.fakturTidakAda;

  // 2. Nilai taksasi
  const persenTaksasi = hitungPersenTaksasi(km, tahunMotor, refYear);
  const hargaTaksasi = Math.round(otrNum * persenTaksasi);
  const otrEfektif = Math.max(0, hargaTaksasi - totalPotongan);

  // 3. Profil customer -> jenis angsuran + rasio
  const { angsuranType, ratio } = getCustomerProfile(tipeCustomer, cori, merkMotor, segaris);

  // 4. Plafond
  const plafond =
    plafondOverride && Number(plafondOverride) > 0
      ? Math.round(Number(plafondOverride))
      : Math.max(
          KONSTANTA.plafondMin,
          Math.floor((otrEfektif * ratio) / KONSTANTA.plafondStep) * KONSTANTA.plafondStep
        );

  // 5. Angsuran + biaya
  const angsuran = lookupAngsuran(plafond, tenor, angsuranType);
  const admin = KONSTANTA.adminMurni;
  const warEff = KONSTANTA.warNettEff[angsuranType] ?? 0.54;
  const war = Math.round(plafond * warEff);

  // 6. Potongan top up
  const sisaAngsuranNett = (topUp && Number(sisaAngsuran)) || 0;
  const dendaNett = topUp ? Math.max(0, (Number(denda) || 0) - (Number(dendaTerbayar) || 0)) : 0;
  const collFeeNett = topUp ? Math.max(0, (Number(collFee) || 0) - (Number(collFeeTerbayar) || 0)) : 0;
  const totalDenda = dendaNett + collFeeNett;
  const pajakPotongan = hitungPotonganPajak(Number(lamaPajakMati));
  const meteraiTotal = (Number(meteraiCount) || 0) * KONSTANTA.meteraiPerLembar;
  const biayaTopUp = topUp ? KONSTANTA.biayaTopUp : 0;

  // 7. Terima bersih
  const terimaBersih = Math.max(
    0,
    plafond - sisaAngsuranNett - totalDenda - biayaTopUp - meteraiTotal
  );

  const namaBpkb = segaris ? 'Same' : 'Different';
  const risk = hitungRisk(cori, merkMotor, namaBpkb, tahunMotor, km, refYear);
  const plafondOptions = buildPlafondOptions(otrEfektif, ratio);

  return {
    input: {
      otr: otrNum,
      tipeCustomer,
      cori,
      merkMotor,
      segaris,
      lamaPajakMati: Number(lamaPajakMati) || 0,
      kalengMati,
      fakturAda,
      tenor,
      meteraiCount: Number(meteraiCount) || 0,
      topUp,
      km,
      tahunMotor,
      plafondOverride: Number(plafondOverride) || 0
    },
    totalPotongan,
    persenTaksasi,
    hargaTaksasi,
    otrEfektif,
    ratio,
    angsuranType,
    plafond,
    admin,
    angsuran,
    danaCair: plafond,
    war,
    warNettEff: warEff,
    meterai: meteraiTotal,
    sisaAngsuran: sisaAngsuranNett,
    totalDenda,
    dendaNett,
    collFeeNett,
    pajakPotongan,
    biayaTopUp,
    terimaBersih,
    risk,
    plafondOptions,
    tenorOptions: getTenorOptions(tahunMotor, refYear),
    maxTenor: getMaxTenor(tahunMotor, refYear)
  };
}

/**
 * Bandingkan angsuran untuk semua tenor yang tersedia.
 */
function bandingkanTenor(input) {
  const tenors = getTenorOptions(input.tahunMotor, input.refYear);
  const { angsuranType } = getCustomerProfile(
    input.tipeCustomer || 'New Customer',
    input.cori || 'Good',
    input.merkMotor || 'Honda',
    input.segaris !== false
  );

  const base = hitungTaksasi(input);

  return {
    angsuranType,
    plafond: base.plafond,
    tenorOptions: tenors,
    options: tenors.map((t) => ({
      tenor: t,
      angsuran: lookupAngsuran(base.plafond, t, angsuranType)
    }))
  };
}

module.exports = {
  KONSTANTA,
  DEPRESIASI,
  MATRIKS_CUSTOMER,
  TENOR_INDEX,
  getRateTable,
  lookupAngsuran,
  getCustomerProfile,
  hitungPotonganPajak,
  getMaxTenor,
  getTenorOptions,
  hitungPersenTaksasi,
  hitungRisk,
  buildPlafondOptions,
  hitungTaksasi,
  bandingkanTenor
};
