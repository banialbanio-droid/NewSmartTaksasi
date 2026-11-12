const XLSX = require('xlsx');

const p = 'C:/Users/USER/Documents/MASTER OKTOBER/MASTER PRICELIST ANGSURAN.xlsx';
const wb = XLSX.readFile(p, { cellDates: false });

console.log('=== SHEETS ===');
wb.SheetNames.forEach((n) => {
  const ws = wb.Sheets[n];
  console.log(`- ${n} | ref=${ws['!ref']}`);
});

// Dump 25 baris pertama tiap sheet supaya struktur terbaca
wb.SheetNames.forEach((n) => {
  console.log(`\n\n########## ${n} ##########`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], {
    header: 1,
    raw: true,
    defval: null,
  });
  console.log('total baris:', rows.length);
  rows.slice(0, 25).forEach((r, i) => {
    console.log(i, JSON.stringify(r));
  });
});
