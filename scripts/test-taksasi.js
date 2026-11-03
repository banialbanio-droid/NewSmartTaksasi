/**
 * Smoke test endpoint taksasi + verifikasi silang ke index.html.
 * Jalankan: node scripts/test-taksasi.js
 */
const fs = require('fs');
const vm = require('vm');

const BASE = 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

// --- Muat referensi HSe dari index.html untuk verifikasi silang -------------
function loadReference() {
  const html = fs.readFileSync(
    'C:/Users/USER/.gemini/antigravity-ide/PROJECT SMART TAKSASI V3.2/index.html',
    'utf-8'
  );
  const tableStart = html.indexOf('const CALC_REGULER_TABLE = JSON.parse(');
  const tableEnd = html.indexOf('const Yo = {');
  const tableBlock = html.slice(tableStart, tableEnd);

  const s2 = html.indexOf('const Yo = {');
  const e2 = html.indexOf('const ISe = { 6: 0, 8: 1, 12: 2, 16: 3, 18: 3, 24: 4, 36: 5 };');
  const constBlock = html.slice(s2, e2 + 'const ISe = { 6: 0, 8: 1, 12: 2, 16: 3, 18: 3, 24: 4, 36: 5 };'.length);

  const s3 = html.indexOf('function PSe(angsuranType) {');
  const e3 = html.indexOf('\n    // Input Handlers');
  const funcBlock = html.slice(s3, e3);

  const src = `${tableBlock}\n${constBlock}\n${funcBlock}\nmodule.exports={HSe};`;
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'ref.js' });
  return sandbox.module.exports;
}

(async () => {
  console.log('=== SMOKE TEST ENDPOINT TAKSASI ===\n');

  const login = await req('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csId: 'SPV-PARUNG', pin: '123456' })
  });
  if (!login.body.success) {
    console.log('Login gagal:', JSON.stringify(login.body));
    process.exit(1);
  }
  const H = { Authorization: `Bearer ${login.body.token}`, 'Content-Type': 'application/json' };
  console.log('[OK] login\n');

  // 1. Config
  const cfg = await req('/api/v1/taksasi/config', { headers: H });
  console.log(`[${cfg.status}] GET /taksasi/config`);
  if (cfg.body.success) {
    const d = cfg.body.data;
    console.log(`      adminMurni=${d.konstanta.adminMurni} warNettEff=${JSON.stringify(d.konstanta.warNettEff)}`);
    console.log(`      matriksCustomer=${d.matriksCustomer.length} entri, tenor=${d.konstanta.tenorTersedia.join('/')}`);
  } else console.log('      ', JSON.stringify(cfg.body));

  // 2. Tenor options
  const to = await req('/api/v1/taksasi/tenor-options?tahunMotor=2020', { headers: H });
  console.log(`\n[${to.status}] GET /taksasi/tenor-options?tahunMotor=2020`);
  console.log('      ', JSON.stringify(to.body.data));

  // 3. Angsuran lookup
  const ang = await req('/api/v1/taksasi/angsuran?plafond=15000000&tenor=12&tipe=Reguler', { headers: H });
  console.log(`\n[${ang.status}] GET /taksasi/angsuran?plafond=15000000&tenor=12&tipe=Reguler`);
  console.log('      ', JSON.stringify(ang.body.data));

  // 4. Persen taksasi
  const pt = await req('/api/v1/taksasi/persen-taksasi?km=45000&tahunMotor=2020', { headers: H });
  console.log(`\n[${pt.status}] GET /taksasi/persen-taksasi?km=45000&tahunMotor=2020`);
  console.log('      ', JSON.stringify(pt.body.data));

  // 5. Hitung penuh
  const payload = {
    otr: 15000000,
    tipeCustomer: 'New Customer',
    cori: 'Good',
    merkMotor: 'Honda',
    segaris: true,
    lamaPajakMati: 0,
    kalengMati: false,
    fakturAda: true,
    tenor: 12,
    meteraiCount: 0,
    topUp: false,
    km: '',
    tahunMotor: 2020
  };
  const hit = await req('/api/v1/taksasi/hitung', {
    method: 'POST',
    headers: H,
    body: JSON.stringify(payload)
  });
  console.log(`\n[${hit.status}] POST /taksasi/hitung`);
  if (hit.body.success) {
    const d = hit.body.data;
    console.log(`      OTR=${d.input.otr} tipe=${d.angsuranType} ratio=${d.ratio}`);
    console.log(`      totalPotongan=${d.totalPotongan} persenTaksasi=${d.persenTaksasi} hargaTaksasi=${d.hargaTaksasi}`);
    console.log(`      otrEfektif=${d.otrEfektif} plafond=${d.plafond} angsuran=${d.angsuran}`);
    console.log(`      admin=${d.admin} war=${d.war} terimaBersih=${d.terimaBersih} risk=${d.risk}`);
    console.log(`      plafondOptions=${d.plafondOptions.length} opsi, max=${d.plafondOptions[0].pinjaman}`);
  } else console.log('      ', JSON.stringify(hit.body));

  // 6. Bandingkan tenor
  const cmp = await req('/api/v1/taksasi/bandingkan-tenor', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ ...payload, tahunMotor: 2020 })
  });
  console.log(`\n[${cmp.status}] POST /taksasi/bandingkan-tenor`);
  if (cmp.body.success) {
    console.log(`      tipe=${cmp.body.data.angsuranType} plafond=${cmp.body.data.plafond}`);
    cmp.body.data.options.forEach((o) => console.log(`      tenor ${o.tenor}bln -> Rp ${o.angsuran.toLocaleString('id-ID')}`));
  } else console.log('      ', JSON.stringify(cmp.body));

  // 7. Validasi error
  console.log('\n--- VALIDASI INPUT ---');
  const badCases = [
    ['OTR kosong', { ...payload, otr: 0 }],
    ['Tenor tidak valid', { ...payload, tenor: 7 }],
    ['Tenor tidak tersedia utk tahun motor', { ...payload, tahunMotor: 2005, tenor: 36 }],
    ['Tipe customer salah', { ...payload, tipeCustomer: 'Platinum' }],
    ['Pajak mati > 8', { ...payload, lamaPajakMati: 12 }]
  ];
  for (const [label, body] of badCases) {
    const r = await req('/api/v1/taksasi/hitung', { method: 'POST', headers: H, body: JSON.stringify(body) });
    console.log(`  [${r.status}] ${label}: ${r.body.code || 'OK'} — ${(r.body.message || '').slice(0, 70)}`);
  }

  // 8. VERIFIKASI SILANG: endpoint vs HSe asli, 200 kombinasi
  console.log('\n=== VERIFIKASI SILANG ENDPOINT vs index.html HSe ===');
  const ref = loadReference();
  const FIELDS = [
    'totalPotongan', 'persenTaksasi', 'hargaTaksasi', 'otrEfektif', 'ratio',
    'angsuranType', 'plafond', 'admin', 'angsuran', 'danaCair', 'war',
    'warNettEff', 'meterai', 'sisaAngsuran', 'totalDenda', 'dendaNett',
    'collFeeNett', 'pajakPotongan', 'terimaBersih', 'risk'
  ];

  const combos = [];
  for (const otr of [8000000, 15000000, 28000000])
    for (const tipe of ['New Customer', 'Repeat Order'])
      for (const cori of ['Good Loyal', 'Medium'])
        for (const merk of ['Honda', 'Non Honda'])
          for (const seg of [true, false])
            for (const tenor of [6, 12, 24])
              for (const km of ['', 55000])
                for (const thn of [2016, 2021])
                  combos.push({ otr, tipe, cori, merk, seg, tenor, km, thn });

  let tested = 0;
  let mismatch = 0;
  const fails = [];

  for (const c of combos) {
    const body = {
      otr: c.otr,
      tipeCustomer: c.tipe,
      cori: c.cori,
      merkMotor: c.merk,
      segaris: c.seg,
      lamaPajakMati: 0,
      kalengMati: false,
      fakturAda: true,
      tenor: c.tenor,
      meteraiCount: 0,
      topUp: false,
      km: c.km,
      tahunMotor: c.thn
    };
    const r = await req('/api/v1/taksasi/hitung', { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (!r.body.success) continue;
    tested++;

    const refResult = ref.HSe({
      otr: c.otr,
      tipe_customer: c.tipe,
      cori: c.cori,
      merk_motor: c.merk,
      segaris: c.seg,
      lama_pajak_mati: 0,
      kaleng_mati: false,
      faktur_ada: true,
      tenor: c.tenor,
      meterai_count: 0,
      top_up: false,
      sisa_angsuran: 0,
      denda: 0,
      denda_terbayar: 0,
      coll_fee: 0,
      coll_fee_terbayar: 0,
      km: c.km,
      tahun_motor: c.thn,
      plafond_override: 0
    });

    for (const f of FIELDS) {
      const a = refResult[f];
      const b = r.body.data[f];
      const same = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;
      if (!same) {
        mismatch++;
        if (fails.length < 5) fails.push(`${f}: ref=${a} api=${b} (otr=${c.otr} ${c.tipe} ${c.cori} ${c.merk} seg=${c.seg} t=${c.tenor} km=${c.km} thn=${c.thn})`);
      }
    }
  }

  console.log(`Endpoint diuji : ${tested}`);
  console.log(`Field dicek    : ${tested * FIELDS.length}`);
  console.log(`Mismatch       : ${mismatch}`);
  if (fails.length) fails.forEach((f) => console.log('  ' + f));

  console.log('\n=== HASIL ===');
  if (mismatch === 0) {
    console.log('LULUS — endpoint API menghasilkan angka identik dengan index.html.');
    process.exit(0);
  } else {
    console.log('GAGAL');
    process.exit(1);
  }
})();
