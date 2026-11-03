const calc = require('../src/services/taksasiCalculator');

const refYear = 2026;
const tahun = 2020;

console.log('=== ANALISIS DEPRESIASI ===');
console.log(`Tahun motor ${tahun}, refYear ${refYear} -> umur ${refYear - tahun}`);
console.log('DEPRESIASI[6]:', JSON.stringify(calc.DEPRESIASI[6]));
console.log('');

const pwajar = calc.DEPRESIASI[6].pwajar;
const samples = [0, 20000, 45000, 60000, 70000, 75000, 80000, 85000, 95000, 105000, 120000, 200000];

console.log('km'.padStart(8), '| selisih'.padStart(9), '| bucket'.padStart(6), '| %taksasi');
console.log('-'.repeat(46));
for (const km of samples) {
  const d = km - pwajar;
  let bucket;
  if (d <= 0) bucket = 0;
  else if (d <= 10000) bucket = 1;
  else if (d <= 20000) bucket = 2;
  else if (d <= 30000) bucket = 3;
  else if (d <= 40000) bucket = 4;
  else if (d <= 50000) bucket = 5;
  else bucket = 6;
  const pct = calc.hitungPersenTaksasi(km, tahun, refYear);
  console.log(String(km).padStart(8), '|', String(d).padStart(9), '|', String(bucket).padStart(6), '|', (pct * 100).toFixed(4) + '%');
}

console.log('\nCatatan: KM di bawah KM wajar menghasilkan faktor 1.0 (100%).');
console.log('Ini perilaku asli index.html — bukan bug port.');
console.log('\nContoh di mana depresiasi BENAR-BENAR berlaku:');
for (const km of [80000, 90000, 100000, 110000]) {
  const pct = calc.hitungPersenTaksasi(km, tahun, refYear);
  const otr = 15000000;
  console.log(`  km=${km} -> ${(pct * 100).toFixed(4)}% -> harga taksasi Rp ${Math.round(otr * pct).toLocaleString('id-ID')}`);
}
