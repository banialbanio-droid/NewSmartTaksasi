const XLSX = require('xlsx');

const p = 'C:/Users/USER/Documents/MASTER OKTOBER/MASTER PRICELIST ANGSURAN.xlsx';
const wb = XLSX.readFile(p);

function blokUtama(namaSheet) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[namaSheet], {
    header: 1, raw: true, defval: null,
  });

  // Baris 5 (index 5) memuat daftar tenor; baris 7+ memuat data.
  const tenorRow = rows[5] || [];
  const tenor = [];
  for (let c = 1; c <= 6; c++) {
    const v = tenorRow[c];
    if (typeof v === 'number' && v > 0) tenor.push({ col: c, tenor: v });
  }

  const data = [];
  for (let i = 7; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const dana = r[0];
    if (typeof dana !== 'number' || dana <= 0) continue;

    const angsuran = {};
    let adaIsi = false;
    tenor.forEach(({ col, tenor: t }) => {
      const v = r[col];
      if (typeof v === 'number' && v > 0) {
        angsuran[t] = v;
        adaIsi = true;
      }
    });
    if (!adaIsi) continue;

    data.push({ danaCair: dana, angsuran });
  }

  return { tenor: tenor.map((t) => t.tenor), data };
}

['Reguler', 'Awda'].forEach((s) => {
  const { tenor, data } = blokUtama(s);
  console.log(`\n=== ${s} ===`);
  console.log('tenor:', tenor.join(', '));
  console.log('jumlah baris data:', data.length);
  console.log('dana cair min/max:', data[0].danaCair, '/', data[data.length - 1].danaCair);
  console.log('contoh 3 pertama:', JSON.stringify(data.slice(0, 3)));
  console.log('contoh 3 terakhir:', JSON.stringify(data.slice(-3)));

  // Cek apakah dana cair berurutan kelipatan 250.000
  let gap = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].danaCair - data[i - 1].danaCair !== 250000) gap++;
  }
  console.log('baris yang tidak berjarak 250rb:', gap);

  // Cek kelengkapan tenor
  const tidakLengkap = data.filter((d) => Object.keys(d.angsuran).length !== tenor.length).length;
  console.log('baris dengan tenor tidak lengkap:', tidakLengkap);
});
