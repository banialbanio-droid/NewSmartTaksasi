const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getDb, initDb } = require('./database');

const PROJECT_PATH = path.join('C:', 'Users', 'USER', '.gemini', 'antigravity-ide', 'PROJECT SMART TAKSASI V3.2');
const MAIN_FILE = path.join(PROJECT_PATH, 'DATABASE SMART TAKSASI OCTOBER.xlsx');
const RO_FILE = path.join(PROJECT_PATH, 'BAHAN FOLLOW GFORM_PLUS62.xlsx');

const norm = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};
const intOrNull = (v) => {
  const n = parseInt(num(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Excel serial date (1900 system) -> ISO date string "YYYY-MM-DD"
const excelDate = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 60000) {
    // Bukan serial date — kembalikan apa adanya kalau terlihat seperti tanggal
    const s = norm(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = days 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
};

function readSheet(filePath, matcher) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const name = wb.SheetNames.find((s) => matcher.test(s));
  if (!name) {
    throw new Error(`Sheet tidak ditemukan di ${path.basename(filePath)}. Tersedia: ${wb.SheetNames.join(', ')}`);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  return { sheetName: name, rows };
}

/**
 * Insert rows in one transaction with a prepared statement.
 * INSERT OR IGNORE + UNIQUE constraints make this idempotent.
 */
function insertBatch(db, sql, rows, label) {
  return new Promise((resolve, reject) => {
    if (rows.length === 0) return resolve({ inserted: 0, skipped: 0 });

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) return reject(beginErr);

        const stmt = db.prepare(sql);
        let changes = 0;
        let errors = 0;
        let done = 0;

        rows.forEach((row) => {
          stmt.run(row, function (err) {
            if (err) errors++;
            else changes += this.changes;
            done++;
            if (done === rows.length) {
              stmt.finalize((finErr) => {
                if (finErr) return db.run('ROLLBACK', () => reject(finErr));
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return db.run('ROLLBACK', () => reject(commitErr));
                  if (errors > 0) console.log(`    (${errors} baris gagal di ${label})`);
                  resolve({ inserted: changes, skipped: rows.length - changes });
                });
              });
            }
          });
        });
      });
    });
  });
}

async function migrateOTR(db) {
  console.log('\n[1/4] HARGA PASAR (OTR)');
  const { sheetName, rows } = readSheet(MAIN_FILE, /harga\s*pasar/i);
  console.log(`  Sheet: "${sheetName}" - ${rows.length - 1} baris data`);

  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const brand = norm(r[0]);
    const model = norm(r[1]);
    // Beberapa baris (mis. TIGER SH/DH) tidak punya brand di Excel.
    // Yang wajib ada hanya model; brand kosong tetap disimpan.
    if (!model) continue;
    payload.push([
      brand, model, norm(r[2]), norm(r[3]), norm(r[4]), norm(r[5]),
      intOrNull(r[6]), Math.round(num(r[7]))
    ]);
  }

  const result = await insertBatch(
    db,
    `INSERT OR IGNORE INTO otr_prices (brand, model, object_type, object_description, group_type_unit, vehicle, tahun, harga_pasar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    payload, 'OTR'
  );
  console.log(`  OK ${result.inserted} baris masuk, ${result.skipped} dilewati`);
}

async function migrateCLOP(db) {
  console.log('\n[2/4] BAHAN CLOP HO');
  const { sheetName, rows } = readSheet(MAIN_FILE, /clop/i);
  console.log(`  Sheet: "${sheetName}" - ${rows.length - 1} baris data`);

  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const contractNo = norm(r[0]);
    if (!contractNo) continue;
    payload.push([contractNo, norm(r[1]), norm(r[2])]);
  }

  const result = await insertBatch(
    db,
    `INSERT OR IGNORE INTO clop_contracts (contract_no, cycle_awal, trend_cycle) VALUES (?, ?, ?)`,
    payload, 'CLOP'
  );
  console.log(`  OK ${result.inserted} baris masuk, ${result.skipped} dilewati`);
}

async function migrateBQ(db) {
  console.log('\n[3/4] BOOKING QUALITY');
  const { sheetName, rows } = readSheet(MAIN_FILE, /booking\s*quality/i);
  console.log(`  Sheet: "${sheetName}" - ${rows.length - 1} baris data`);

  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const contractNo = norm(r[0]);
    const customerName = norm(r[1]);
    if (!contractNo || !customerName) continue;

    // Layout Excel BQ = 16 kolom (GAS COL_BQ hanya 15):
    // 10 Alamat, 11 Plafon, 12 DPD, 13 Status, 14 Reason, 15 Janji Bayar
    payload.push([
      contractNo, customerName, norm(r[2]), excelDate(r[3]),
      parseInt(num(r[4]), 10) || 1, norm(r[5]), Math.round(num(r[6])),
      norm(r[7]), norm(r[8]), norm(r[9]), norm(r[10]), num(r[11]),
      Math.round(num(r[12])), norm(r[13]).toUpperCase() || 'BELUM BAYAR',
      norm(r[14]), norm(r[15])
    ]);
  }

  const result = await insertBatch(
    db,
    `INSERT OR IGNORE INTO booking_quality
     (contract_no, customer_name, phone, jatuh_tempo, angs_ke, beban_bq, install_amt, cs_id, nama_mce,
      cori_grade, alamat, plafon, overdue, status_bq, reason, janji_bayar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    payload, 'BQ'
  );
  console.log(`  OK ${result.inserted} baris masuk, ${result.skipped} dilewati`);
}

async function migrateRO(db) {
  console.log('\n[4/4] REPEAT ORDER (BAHAN GFORM)');
  const file = fs.existsSync(RO_FILE) ? RO_FILE : MAIN_FILE;
  const { sheetName, rows } = readSheet(file, /gform|data\s*ro/i);
  console.log(`  Sheet: "${sheetName}" (${path.basename(file)}) - ${rows.length - 1} baris data`);

  // Layout GFORM = 13 kolom:
  // 0 CS ID, 1 MARKETING, 2 NAMA KONSUMEN, 3 NO KONTRAK, 4 NO HP, 5 TAHUN UNIT,
  // 6 OBJ_TYPE, 7 OBJ_CODE, 8 OBJ_MODEL, 9 OBJ_DESC, 10 NOPOL, 11 TIPE CORI, 12 SISA TENOR
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const csId = norm(r[0]);
    const namaMce = norm(r[1]);
    const customerName = norm(r[2]);
    const contractNo = norm(r[3]).replace(/\.0$/, '');
    const phone = norm(r[4]);
    const tahun = intOrNull(r[5]);
    const objType = norm(r[6]);
    const objCode = norm(r[7]);
    const objModel = norm(r[8]);
    const objDesc = norm(r[9]);
    const noPolisi = norm(r[10]);
    const coriGrade = norm(r[11]);
    const sisaAngsuran = parseInt(num(r[12]), 10) || 1;

    if (!contractNo || !customerName) continue;

    payload.push([
      csId, namaMce, contractNo, customerName, phone, coriGrade,
      '', tahun, objCode, objType, objModel, objDesc, noPolisi,
      sisaAngsuran, 'BARU', ''
    ]);
  }

  const result = await insertBatch(
    db,
    `INSERT OR IGNORE INTO repeat_orders
     (cs_id, nama_mce, contract_no, customer_name, phone, cori_grade, brand, tahun, obj_code, obj_type,
      obj_model, obj_desc, no_polisi, sisa_angsuran, status_followup, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    payload, 'RO'
  );
  console.log(`  OK ${result.inserted} baris masuk, ${result.skipped} dilewati`);
}

function countAll(db) {
  return new Promise((resolve) => {
    const tables = ['users', 'otr_prices', 'clop_contracts', 'booking_quality', 'repeat_orders'];
    const out = {};
    let left = tables.length;
    tables.forEach((t) => {
      db.get(`SELECT COUNT(*) AS c FROM ${t}`, (err, row) => {
        out[t] = err ? `ERR ${err.message}` : row.c;
        left--;
        if (left === 0) resolve(out);
      });
    });
  });
}

async function main() {
  const db = getDb();
  await initDb();

  console.log('=== MIGRASI SMART TAKSASI V3.2 ===');
  await migrateOTR(db);
  await migrateCLOP(db);
  await migrateBQ(db);
  await migrateRO(db);

  const counts = await countAll(db);
  console.log('\n=== RINGKASAN ISI DATABASE ===');
  for (const [t, c] of Object.entries(counts)) {
    console.log(`  ${t.padEnd(18)} ${c}`);
  }

  db.close();
  console.log('\nMigrasi selesai.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration error:', err.message);
  process.exit(1);
});
