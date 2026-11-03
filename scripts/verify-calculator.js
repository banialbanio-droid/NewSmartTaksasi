/**
 * VERIFIKASI: bandingkan port Node dengan fungsi asli HSe dari index.html.
 *
 * Cara kerja: ekstrak blok kalkulator dari index.html (CALC_*_TABLE, Yo, OSe,
 * DSe, ISe, PSe, YK, JK, cM, jSe, uM, QSe, MSe, LSe, HSe) lalu jalankan di
 * VM Node, kemudian bandingkan output per field dengan src/services/taksasiCalculator.js
 * untuk ratusan kombinasi input.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const calc = require('../src/services/taksasiCalculator');

const HTML_PATH = 'C:/Users/USER/.gemini/antigravity-ide/PROJECT SMART TAKSASI V3.2/index.html';
const html = fs.readFileSync(HTML_PATH, 'utf-8');

// --- Ekstrak blok kalkulator dari index.html -------------------------------
function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s === -1) throw new Error(`start not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  if (e === -1) throw new Error(`end not found: ${endMarker}`);
  return src.slice(s, e + endMarker.length);
}

// Blok tabel: dari CALC_REGULER_TABLE sampai tepat sebelum "const Yo = {"
// (CALC_AWDA_TABLE ada di antaranya)
const tableStart = html.indexOf('const CALC_REGULER_TABLE = JSON.parse(');
const tableEnd = html.indexOf('const Yo = {');
if (tableStart === -1 || tableEnd === -1 || tableEnd < tableStart) {
  throw new Error('Blok tabel rate tidak ditemukan di index.html');
}
const tableBlock = html.slice(tableStart, tableEnd);

const constBlock = sliceBetween(html, 'const Yo = {', 'const ISe = { 6: 0, 8: 1, 12: 2, 16: 3, 18: 3, 24: 4, 36: 5 };');

const funcBlock = sliceBetween(html, 'function PSe(angsuranType) {', '\n    // Input Handlers');

const source = `${tableBlock}\n${constBlock}\n${funcBlock}\n
module.exports = { CALC_REGULER_TABLE, CALC_AWDA_TABLE, Yo, OSe, DSe, ISe, PSe, YK, JK, cM, jSe, uM, QSe, MSe, LSe, HSe };
`;

const sandbox = { module: { exports: {} }, console };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'extracted-calc.js' });
const ref = sandbox.module.exports;

console.log('=== REFERENSI DARI index.html ===');
console.log('CALC_REGULER_TABLE rows:', Object.keys(ref.CALC_REGULER_TABLE).length);
console.log('CALC_AWDA_TABLE rows   :', Object.keys(ref.CALC_AWDA_TABLE).length);
console.log('HSe tersedia:', typeof ref.HSe === 'function');

// --- Bandingkan tabel rate --------------------------------------------------
console.log('\n=== 1. TABEL RATE ===');
{
  const mine = calc.getRateTable('Reguler');
  const refKeys = Object.keys(ref.CALC_REGULER_TABLE).map(Number).sort((a, b) => a - b);
  let mismatch = 0;
  for (const k of refKeys) {
    const a = JSON.stringify(ref.CALC_REGULER_TABLE[String(k)]);
    const b = JSON.stringify(mine.table[String(k)]);
    if (a !== b) mismatch++;
  }
  console.log(`Reguler: ref=${refKeys.length} rows, mine=${mine.keys.length} rows, mismatch=${mismatch}`);
}
{
  const mine = calc.getRateTable('Awda');
  const refKeys = Object.keys(ref.CALC_AWDA_TABLE).map(Number).sort((a, b) => a - b);
  let mismatch = 0;
  for (const k of refKeys) {
    const a = JSON.stringify(ref.CALC_AWDA_TABLE[String(k)]);
    const b = JSON.stringify(mine.table[String(k)]);
    if (a !== b) mismatch++;
  }
  console.log(`Awda   : ref=${refKeys.length} rows, mine=${mine.keys.length} rows, mismatch=${mismatch}`);
}

// --- Bandingkan fungsi-fungsi kecil ---------------------------------------
console.log('\n=== 2. FUNGSI PENDUKUNG ===');
let smallFail = 0;

// YK / lookupAngsuran
for (const type of ['Reguler', 'Awda']) {
  for (const plafond of [3000000, 3249999, 3250000, 5000000, 15000000, 23456789, 60000000, 70000000]) {
    for (const tenor of [6, 8, 12, 16, 18, 24, 36]) {
      const a = ref.YK(plafond, tenor, type);
      const b = calc.lookupAngsuran(plafond, tenor, type);
      if (a !== b) {
        smallFail++;
        if (smallFail <= 5) console.log(`  YK mismatch ${type} p=${plafond} t=${tenor}: ref=${a} mine=${b}`);
      }
    }
  }
}

// JK / getCustomerProfile
const custCombos = [];
for (const tipe of ['New Customer', 'Repeat Order', 'Kaleng Hidup']) {
  for (const cori of ['Good Loyal', 'Good', 'Medium']) {
    for (const merk of ['Honda', 'Non Honda']) {
      for (const seg of [true, false]) custCombos.push([tipe, cori, merk, seg]);
    }
  }
}
for (const [tipe, cori, merk, seg] of custCombos) {
  const a = ref.JK(tipe, cori, merk, seg);
  const b = calc.getCustomerProfile(tipe, cori, merk, seg);
  if (a.angsuranType !== b.angsuranType || a.ratio !== b.ratio) {
    smallFail++;
    console.log(`  JK mismatch ${tipe}|${cori}|${merk}|${seg}: ref=${JSON.stringify(a)} mine=${JSON.stringify(b)}`);
  }
}

// cM / hitungPotonganPajak
for (let n = 0; n <= 10; n++) {
  const a = ref.cM(n);
  const b = calc.hitungPotonganPajak(n);
  if (a !== b) {
    smallFail++;
    console.log(`  cM mismatch ${n}: ref=${a} mine=${b}`);
  }
}

// jSe / getMaxTenor  &  uM / getTenorOptions
for (let y = 1990; y <= 2026; y++) {
  const a = ref.jSe(y);
  const b = calc.getMaxTenor(y, 2026);
  if (a !== b) {
    smallFail++;
    console.log(`  jSe mismatch ${y}: ref=${a} mine=${b}`);
  }
  const au = JSON.stringify(ref.uM(y));
  const bu = JSON.stringify(calc.getTenorOptions(y, 2026));
  if (au !== bu) {
    smallFail++;
    console.log(`  uM mismatch ${y}: ref=${au} mine=${bu}`);
  }
}

// QSe / hitungPersenTaksasi
for (const km of ['', 0, 5000, 10000, 15000, 25000, 35000, 45000, 55000, 75000, 150000]) {
  for (const thn of ['', 2010, 2015, 2018, 2020, 2024, 2026]) {
    const a = ref.QSe(km, thn, 2026);
    const b = calc.hitungPersenTaksasi(km, thn, 2026);
    if (Math.abs(a - b) > 1e-12) {
      smallFail++;
      if (smallFail <= 8) console.log(`  QSe mismatch km=${km} thn=${thn}: ref=${a} mine=${b}`);
    }
  }
}

// MSe / hitungRisk
for (const cori of ['Good Loyal', 'Good', 'Medium']) {
  for (const merk of ['Honda', 'Non Honda']) {
    for (const bpkb of ['Same', 'Different']) {
      for (const thn of [2010, 2018, 2022, 2026]) {
        for (const km of [0, 30000, 50000, 70000, 150000]) {
          const a = ref.MSe(cori, merk, bpkb, thn, km, 2026);
          const b = calc.hitungRisk(cori, merk, bpkb, thn, km, 2026);
          if (a !== b) {
            smallFail++;
            if (smallFail <= 8) console.log(`  MSe mismatch ${cori}|${merk}|${bpkb}|${thn}|${km}: ref=${a} mine=${b}`);
          }
        }
      }
    }
  }
}

// LSe / buildPlafondOptions
for (const otrEf of [0, 1000000, 5000000, 15000000, 30000000, 60000000]) {
  for (const ratio of [0.5, 0.7, 0.85]) {
    const a = JSON.stringify(ref.LSe(otrEf, ratio));
    const b = JSON.stringify(calc.buildPlafondOptions(otrEf, ratio));
    if (a !== b) {
      smallFail++;
      console.log(`  LSe mismatch ${otrEf}/${ratio}: ref=${a.slice(0, 120)} mine=${b.slice(0, 120)}`);
    }
  }
}

console.log(smallFail === 0 ? '  Semua fungsi pendukung COCOK' : `  TOTAL MISMATCH: ${smallFail}`);

// --- Bandingkan HSe vs hitungTaksasi penuh --------------------------------
console.log('\n=== 3. PERHITUNGAN PENUH (HSe) ===');

const cases = [];
const otrs = [5000000, 12000000, 15000000, 18500000, 25000000, 40000000];
const tipeCust = ['New Customer', 'Repeat Order'];
const coris = ['Good Loyal', 'Good', 'Medium'];
const merks = ['Honda', 'Non Honda'];
const segarisOpts = [true, false];
const tenorOpts = [6, 12, 24, 36];
const pajakOpts = [0, 1, 3, 8];
const kalengOpts = [false, true];
const fakturOpts = [true, false];
const kmOpts = ['', 45000];
const thnOpts = [2015, 2020];

// Kombinasi penuh akan sangat banyak; ambil sampling deterministik yang lebar.
for (const otr of otrs)
  for (const tipe of tipeCust)
    for (const cori of coris)
      for (const merk of merks)
        for (const seg of segarisOpts)
          for (const tenor of tenorOpts)
            for (const pajak of pajakOpts)
              for (const kaleng of kalengOpts)
                for (const faktur of fakturOpts)
                  for (const km of kmOpts)
                    for (const thn of thnOpts)
                      cases.push({
                        otr, tipe_customer: tipe, cori, merk_motor: merk, segaris: seg,
                        lama_pajak_mati: pajak, kaleng_mati: kaleng, faktur_ada: faktur,
                        tenor, meterai_count: 0, top_up: false,
                        sisa_angsuran: 0, denda: 0, denda_terbayar: 0,
                        coll_fee: 0, coll_fee_terbayar: 0,
                        km, tahun_motor: thn, plafond_override: 0
                      });

// Tambahan: kasus top up
for (const otr of [15000000, 25000000]) {
  cases.push({
    otr, tipe_customer: 'Repeat Order', cori: 'Good', merk_motor: 'Honda', segaris: true,
    lama_pajak_mati: 2, kaleng_mati: true, faktur_ada: true, tenor: 12, meterai_count: 3,
    top_up: true, sisa_angsuran: 4500000, denda: 250000, denda_terbayar: 100000,
    coll_fee: 150000, coll_fee_terbayar: 50000, km: 55000, tahun_motor: 2019,
    plafond_override: 0
  });
}

// Tambahan: plafond override
for (const override of [5000000, 8250000, 12000000]) {
  cases.push({
    otr: 20000000, tipe_customer: 'New Customer', cori: 'Good', merk_motor: 'Honda',
    segaris: true, lama_pajak_mati: 0, kaleng_mati: false, faktur_ada: true,
    tenor: 24, meterai_count: 0, top_up: false, sisa_angsuran: 0, denda: 0,
    denda_terbayar: 0, coll_fee: 0, coll_fee_terbayar: 0, km: '', tahun_motor: 2021,
    plafond_override: override
  });
}

const FIELDS = [
  'totalPotongan', 'persenTaksasi', 'hargaTaksasi', 'otrEfektif', 'ratio',
  'angsuranType', 'plafond', 'admin', 'angsuran', 'danaCair', 'war',
  'warNettEff', 'meterai', 'sisaAngsuran', 'totalDenda', 'dendaNett',
  'collFeeNett', 'pajakPotongan', 'terimaBersih', 'risk'
];

let checked = 0;
let fieldFail = 0;
const failSamples = [];

for (const c of cases) {
  const a = ref.HSe(c);
  const b = calc.hitungTaksasi({
    otr: c.otr,
    tipeCustomer: c.tipe_customer,
    cori: c.cori,
    merkMotor: c.merk_motor,
    segaris: c.segaris,
    lamaPajakMati: c.lama_pajak_mati,
    kalengMati: c.kaleng_mati,
    fakturAda: c.faktur_ada,
    tenor: c.tenor,
    meteraiCount: c.meterai_count,
    topUp: c.top_up,
    sisaAngsuran: c.sisa_angsuran,
    denda: c.denda,
    dendaTerbayar: c.denda_terbayar,
    collFee: c.coll_fee,
    collFeeTerbayar: c.coll_fee_terbayar,
    km: c.km,
    tahunMotor: c.tahun_motor,
    plafondOverride: c.plafond_override,
    refYear: 2026
  });

  checked++;
  for (const f of FIELDS) {
    const av = a[f];
    const bv = b[f];
    const same = typeof av === 'number' && typeof bv === 'number'
      ? Math.abs(av - bv) < 1e-9
      : av === bv;
    if (!same) {
      fieldFail++;
      if (failSamples.length < 10) {
        failSamples.push({ case: c, field: f, ref: av, mine: bv });
      }
    }
  }

  // plafondOptions juga dibandingkan
  if (JSON.stringify(a.plafondOptions) !== JSON.stringify(b.plafondOptions)) {
    fieldFail++;
    if (failSamples.length < 10) {
      failSamples.push({ case: c, field: 'plafondOptions', ref: 'differs', mine: 'differs' });
    }
  }
}

console.log(`Kasus diuji      : ${checked}`);
console.log(`Field dibandingkan: ${checked * (FIELDS.length + 1)}`);
console.log(`Mismatch         : ${fieldFail}`);

if (failSamples.length) {
  console.log('\nContoh mismatch:');
  for (const s of failSamples) {
    console.log(`  field=${s.field} ref=${JSON.stringify(s.ref)} mine=${JSON.stringify(s.mine)}`);
    console.log(`    input: otr=${s.case.otr} tipe=${s.case.tipe_customer} cori=${s.case.cori} merk=${s.case.merk_motor} segaris=${s.case.segaris} tenor=${s.case.tenor} pajak=${s.case.lama_pajak_mati} kaleng=${s.case.kaleng_mati} faktur=${s.case.faktur_ada} km=${s.case.km} thn=${s.case.tahun_motor}`);
  }
}

console.log('\n=== HASIL ===');
if (smallFail === 0 && fieldFail === 0) {
  console.log('LULUS — port Node identik dengan kalkulator index.html.');
  process.exit(0);
} else {
  console.log(`GAGAL — ${smallFail} mismatch fungsi pendukung, ${fieldFail} mismatch field perhitungan.`);
  process.exit(1);
}
