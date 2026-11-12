/**
 * Import Price List Angsuran (Reguler & Awda) dari file Excel master.
 *
 * Struktur file sumber (MASTER PRICELIST ANGSURAN.xlsx):
 *   - Sheet "Reguler" dan "Awda"
 *   - Baris ke-6 (index 5) memuat daftar tenor di kolom B..G
 *   - Baris ke-8 ke bawah (index 7+) memuat DANA CAIR di kolom A dan
 *     nominal angsuran per tenor di kolom B..G
 *
 * Kolom H ke kanan berisi blok bantu (WAR Gross, Splitting Rate, dll)
 * yang tidak dipakai app, jadi sengaja diabaikan.
 *
 * Jalankan: node scripts/import-pricelist.js [path-excel]
 * Idempoten: baris yang sudah ada diperbarui (UNIQUE skema+dana_cair).
 */
const path = require('path');
const XLSX = require('xlsx');
const { getDb, initDb } = require('../src/db/database');

const DEFAULT_FILE =
  'C:/Users/USER/Documents/MASTER OKTOBER/MASTER PRICELIST ANGSURAN.xlsx';

/** Skema yang dikenal: nama sheet -> label di app. */
const SKEMA = [
  { sheet: 'Reguler', kode: 'REGULER' },
  { sheet: 'Awda', kode: 'AWDA' },
];

/**
 * Ambil blok utama (kolom A..G) dari satu sheet.
 * Mengembalikan { tenor: number[], data: [{danaCair, angsuran:{tenor:nilai}}] }
 */
function bacaSheet(wb, namaSheet) {
  const ws = wb.Sheets[namaSheet];
  if (!ws) return { tenor: [], data: [] };

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  });

  // Tenor ada di baris index 5, kolom B..G (index 1..6).
  const tenorRow = rows[5] || [];
  const tenor = [];
  for (let c = 1; c <= 6; c++) {
    const v = tenorRow[c];
    if (typeof v === 'number' && v > 0) tenor.push({ col: c, nilai: v });
  }

  const data = [];
  for (let i = 7; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;

    const dana = r[0];
    // Hanya baris dengan dana cair berupa angka positif.
    if (typeof dana !== 'number' || dana <= 0) continue;

    const angsuran = {};
    let ada = false;
    tenor.forEach(({ col, nilai }) => {
      const v = r[col];
      if (typeof v === 'number' && v > 0) {
        angsuran[nilai] = v;
        ada = true;
      }
    });
    if (!ada) continue;

    data.push({ danaCair: Math.round(dana), angsuran });
  }

  return { tenor: tenor.map((t) => t.nilai), data };
}

function simpan(db, kode, baris) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO pricelist_angsuran (skema, dana_cair, angsuran)
       VALUES (?, ?, ?)
       ON CONFLICT(skema, dana_cair) DO UPDATE SET
         angsuran = excluded.angsuran`,
      [kode, baris.danaCair, JSON.stringify(baris.angsuran)],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const file = process.argv[2] || DEFAULT_FILE;
  console.log('Membaca:', file);

  const wb = XLSX.readFile(file);
  const db = getDb();

  // Pastikan tabel sudah ada sebelum menulis.
  await initDb();
  await new Promise((r) => setTimeout(r, 500));

  for (const { sheet, kode } of SKEMA) {
    const { tenor, data } = bacaSheet(wb, sheet);
    if (data.length === 0) {
      console.log(`\n[${kode}] sheet "${sheet}" tidak ditemukan atau kosong — dilewati.`);
      continue;
    }

    // Bersihkan dulu supaya baris yang dihapus di Excel ikut hilang.
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM pricelist_angsuran WHERE skema = ?', [kode], (e) =>
        e ? reject(e) : resolve()
      );
    });

    for (const baris of data) {
      await simpan(db, kode, baris);
    }

    const min = data[0].danaCair;
    const max = data[data.length - 1].danaCair;
    console.log(
      `[${kode}] ${data.length} baris • tenor ${tenor.join('/')} • ` +
        `dana cair ${min.toLocaleString('id-ID')} – ${max.toLocaleString('id-ID')}`
    );
  }

  // Verifikasi hasil di database.
  db.all(
    `SELECT skema, COUNT(*) AS jumlah, MIN(dana_cair) AS min, MAX(dana_cair) AS max
       FROM pricelist_angsuran GROUP BY skema`,
    (err, rows) => {
      if (err) {
        console.error('Gagal verifikasi:', err.message);
        process.exit(1);
      }
      console.log('\n=== ISI DATABASE ===');
      rows.forEach((r) => {
        console.log(
          `${r.skema}: ${r.jumlah} baris • ${r.min} – ${r.max}`
        );
      });
      console.log('\nSelesai.');
      process.exit(0);
    }
  );
}

main().catch((e) => {
  console.error('Import gagal:', e.message);
  process.exit(1);
});
