const XLSX = require('xlsx');
const { getDb } = require('../db/database');
const { CUSTODIAN_CS_ID } = require('../utils/dataOwnership');

/* ------------------------------------------------------------------ *
 * Util normalisasi
 * ------------------------------------------------------------------ */

const norm = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const lower = (v) => norm(v).toLowerCase();

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  // buang pemisah ribuan, pertahankan tanda minus & desimal
  const cleaned = String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const intOrNull = (v) => {
  const n = parseInt(num(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Nomor kontrak dari Excel sering jadi "155000968325.0" atau notasi ilmiah. */
const contractNo = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Math.round(v).toString();
  return norm(v).replace(/\.0+$/, '').replace(/\s/g, '');
};

/** Telepon: buang spasi/titik/strip, normalisasi awalan 0/8 ke 62. */
const phoneNorm = (v) => {
  let s = norm(v).replace(/[^0-9+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('62')) return s;
  if (s.startsWith('0')) return '62' + s.slice(1);
  if (s.startsWith('8')) return '62' + s;
  return s;
};

/** Excel serial date (1900) atau string tanggal -> "YYYY-MM-DD". */
const toDate = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = norm(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${m}-${d}`;
  }
  return '';
};

/* ------------------------------------------------------------------ *
 * Skema tiap jenis data master
 * ------------------------------------------------------------------ *
 * `aliases` dipakai untuk mencocokkan header Excel (fleksibel: huruf
 * kecil, tanpa spasi/underscore). Kalau header tidak dikenali, importer
 * jatuh ke urutan kolom posisional sesuai layout Excel asli.
 */
const SCHEMAS = {
  otr: {
    label: 'OTR / Harga Pasar',
    table: 'otr_prices',
    columns: [
      'brand', 'model', 'object_type', 'object_description',
      'group_type_unit', 'vehicle', 'tahun', 'harga_pasar',
    ],
    aliases: {
      brand: ['brand', 'merek', 'merk', 'objbrand'],
      model: ['model', 'tipe', 'tipemotor', 'objmodel'],
      object_type: ['objecttype', 'objtype', 'tipeobjek', 'objtipe'],
      object_description: ['objectdescription', 'objdesc', 'deskripsi', 'deskripsiobjek', 'uraian'],
      group_type_unit: ['grouptypeunit', 'group', 'grup', 'kelompokunit', 'groupunit'],
      vehicle: ['vehicle', 'kendaraan', 'unit'],
      tahun: ['tahun', 'year', 'tahunmotor', 'tahununit', 'objtahun'],
      harga_pasar: ['hargapasar', 'harga', 'otr', 'hargaotr', 'price'],
    },
    required: ['model'],
    positional: [
      'brand', 'model', 'object_type', 'object_description',
      'group_type_unit', 'vehicle', 'tahun', 'harga_pasar',
    ],
    insert: `INSERT INTO otr_prices
      (brand, model, object_type, object_description, group_type_unit, vehicle, tahun, harga_pasar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(brand, model, object_type, vehicle, tahun) DO UPDATE SET
        object_description = excluded.object_description,
        group_type_unit = excluded.group_type_unit,
        harga_pasar = excluded.harga_pasar`,
  },

  bq: {
    label: 'Booking Quality',
    table: 'booking_quality',
    columns: [
      'contract_no', 'customer_name', 'phone', 'jatuh_tempo', 'angs_ke',
      'beban_bq', 'install_amt', 'cs_id', 'nama_mce', 'cori_grade',
      'alamat', 'plafon', 'overdue', 'status_bq', 'reason', 'janji_bayar',
    ],
    aliases: {
      contract_no: ['contractno', 'contno', 'nokontrak', 'kontrak', 'contract'],
      customer_name: ['customername', 'namakonsumen', 'nama', 'namanasabah', 'debitur'],
      phone: ['phone', 'phonenumber', 'nohp', 'notelepon', 'telepon', 'tlp', 'nowa', 'whatsapp', 'handphone', 'hp', 'custmobphone', 'mobphone'],
      jatuh_tempo: ['jatuhtempo', 'tgljatuhtempo', 'tanggaljatuhtempo', 'duedate', 'tgltempo'],
      angs_ke: ['angske', 'angsurananake', 'angsurananke', 'installmentno', 'ke'],
      beban_bq: ['bebanbq', 'beban', 'ketbq'],
      install_amt: ['installamt', 'angsuran', 'nominalangsuran', 'angsuranperbulan', 'amount'],
      cs_id: ['csid', 'kodecs', 'idcs', 'marketingid'],
      nama_mce: ['namamce', 'namamcesf', 'mce', 'mcesf', 'marketing', 'namamarketing'],
      cori_grade: ['corigrade', 'corisip', 'cori', 'grade', 'kolektibilitas'],
      alamat: ['alamat', 'address', 'alamatnasabah'],
      plafon: ['plafon', 'plafond', 'pokok'],
      overdue: ['overdue', 'dayspastdue', 'dpd', 'tunggakanhari', 'harioverdue', 'pastdue'],
      status_bq: ['statusbq', 'status', 'statusbayar', 'statuspembayaran'],
      reason: ['reason', 'reasonmarketing', 'alasan', 'keterangan', 'ket'],
      janji_bayar: ['janjibayar', 'tgljanjibayar', 'tanggaljanji', 'promisepay'],
    },
    required: ['contract_no', 'customer_name'],
    positional: [
      'contract_no', 'customer_name', 'phone', 'jatuh_tempo', 'angs_ke',
      'beban_bq', 'install_amt', 'cs_id', 'nama_mce', 'cori_grade',
      'alamat', 'plafon', 'overdue', 'status_bq', 'reason', 'janji_bayar',
    ],
    insert: `INSERT INTO booking_quality
      (contract_no, customer_name, phone, jatuh_tempo, angs_ke, beban_bq, install_amt,
       cs_id, nama_mce, cori_grade, alamat, plafon, overdue, status_bq, reason, janji_bayar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contract_no) DO UPDATE SET
        customer_name = excluded.customer_name,
        phone = excluded.phone,
        jatuh_tempo = excluded.jatuh_tempo,
        angs_ke = excluded.angs_ke,
        beban_bq = excluded.beban_bq,
        install_amt = excluded.install_amt,
        cs_id = excluded.cs_id,
        nama_mce = excluded.nama_mce,
        cori_grade = excluded.cori_grade,
        alamat = excluded.alamat,
        plafon = excluded.plafon,
        overdue = excluded.overdue,
        status_bq = excluded.status_bq,
        reason = excluded.reason,
        janji_bayar = excluded.janji_bayar,
        updated_at = datetime('now')`,
  },

  ro: {
    label: 'Bahan Gform (Repeat Order)',
    table: 'repeat_orders',
    columns: [
      'cs_id', 'nama_mce', 'customer_name', 'contract_no', 'phone', 'brand', 'tahun',
      'obj_type', 'obj_code', 'obj_model', 'obj_desc', 'no_polisi', 'cori_grade', 'sisa_angsuran',
    ],
    aliases: {
      cs_id: ['csid', 'kodecs', 'idcs', 'marketingid'],
      nama_mce: ['namamce', 'namamcesf', 'mce', 'mcesf', 'marketing', 'namamarketing'],
      customer_name: ['customername', 'namakonsumen', 'nama', 'namanasabah', 'debitur'],
      contract_no: ['contractno', 'contno', 'nokontrak', 'kontrak', 'contract'],
      phone: ['phone', 'phonenumber', 'custmobphone', 'mobphone', 'nohp', 'telepon', 'tlp', 'nowa', 'whatsapp', 'handphone', 'hp'],
      brand: ['brand', 'objbrand', 'merek', 'merk'],
      tahun: ['tahun', 'objtahun', 'tahunmotor', 'tahununit', 'year'],
      obj_type: ['objtype', 'tipeobjek', 'tipe'],
      obj_code: ['objcode', 'kodeobjek', 'kode'],
      obj_model: ['objmodel', 'model', 'tipeunit'],
      obj_desc: ['objdesc', 'deskripsi', 'uraian', 'deskripsiobjek'],
      no_polisi: ['nopolisi', 'nopol', 'plat', 'nomorpolisi', 'polisi'],
      cori_grade: ['corigrade', 'corisip', 'cori', 'grade', 'tipecori'],
      sisa_angsuran: ['sisaangsuran', 'sisatenor', 'tenor', 'sisa'],
    },
    required: ['contract_no', 'customer_name'],
    positional: [
      'cs_id', 'nama_mce', 'customer_name', 'contract_no', 'phone', 'brand', 'tahun',
      'obj_type', 'obj_code', 'obj_model', 'obj_desc', 'no_polisi', 'cori_grade', 'sisa_angsuran',
    ],
    insert: `INSERT INTO repeat_orders
      (cs_id, nama_mce, customer_name, contract_no, phone, brand, tahun, obj_type, obj_code,
       obj_model, obj_desc, no_polisi, cori_grade, sisa_angsuran)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contract_no) DO UPDATE SET
        cs_id = excluded.cs_id,
        nama_mce = excluded.nama_mce,
        customer_name = excluded.customer_name,
        phone = excluded.phone,
        brand = excluded.brand,
        tahun = excluded.tahun,
        obj_type = excluded.obj_type,
        obj_code = excluded.obj_code,
        obj_model = excluded.obj_model,
        obj_desc = excluded.obj_desc,
        no_polisi = excluded.no_polisi,
        cori_grade = excluded.cori_grade,
        sisa_angsuran = excluded.sisa_angsuran,
        updated_at = datetime('now')`,
  },

  clop: {
    label: 'Bahan CLOP HO',
    table: 'clop_contracts',
    columns: ['contract_no', 'cycle_awal', 'trend_cycle'],
    aliases: {
      contract_no: ['contractno', 'nokontrak', 'kontrak', 'contract'],
      cycle_awal: ['cycleawal', 'awalcycle', 'cycle', 'siklusawal', 'periodeawal'],
      trend_cycle: ['trendcycle', 'trend', 'siklus', 'trendsiklus'],
    },
    required: ['contract_no'],
    positional: ['contract_no', 'cycle_awal', 'trend_cycle'],
    insert: `INSERT INTO clop_contracts (contract_no, cycle_awal, trend_cycle)
      VALUES (?, ?, ?)
      ON CONFLICT(contract_no) DO UPDATE SET
        cycle_awal = excluded.cycle_awal,
        trend_cycle = excluded.trend_cycle`,
  },
};

/* ------------------------------------------------------------------ *
 * Deteksi header & mapping kolom
 * ------------------------------------------------------------------ */

const headerKey = (s) => lower(s).replace(/[^a-z0-9]/g, '');

/** Cari baris header: baris pertama yang minimal 2 selnya cocok alias. */
function findHeaderRow(rows, schema) {
  const aliasSet = new Set();
  Object.values(schema.aliases).forEach((list) => list.forEach((a) => aliasSet.add(a)));

  const maxScan = Math.min(rows.length, 12);
  let best = { index: -1, score: 0 };

  for (let i = 0; i < maxScan; i++) {
    const row = rows[i] || [];
    let score = 0;
    for (const cell of row) {
      if (aliasSet.has(headerKey(cell))) score++;
    }
    if (score > best.score) best = { index: i, score };
  }

  // Minimal 2 kolom dikenali, kalau tidak dianggap tidak ada header
  return best.score >= 2 ? best.index : -1;
}

/** Bangun peta kolom: canonical field -> index kolom Excel. */
function buildColumnMap(headerRow, schema) {
  const map = {};
  const used = new Set();

  (headerRow || []).forEach((cell, idx) => {
    const key = headerKey(cell);
    if (!key) return;

    for (const [field, aliases] of Object.entries(schema.aliases)) {
      if (map[field] != null) continue;
      if (aliases.includes(key)) {
        map[field] = idx;
        used.add(idx);
        break;
      }
    }
  });

  // Kolom wajib yang belum ketemu -> fallback posisional
  schema.required.forEach((field) => {
    if (map[field] == null) {
      const pos = schema.positional.indexOf(field);
      if (pos >= 0 && !used.has(pos)) {
        map[field] = pos;
        used.add(pos);
      }
    }
  });

  return map;
}

/* ------------------------------------------------------------------ *
 * Transformasi baris -> tuple insert
 * ------------------------------------------------------------------ */

function transform(type, raw, map) {
  const get = (field) => {
    const idx = map[field];
    return idx == null ? '' : raw[idx];
  };

  if (type === 'otr') {
    const model = norm(get('model'));
    return {
      ok: !!model,
      values: [
        norm(get('brand')),
        model,
        norm(get('object_type')),
        norm(get('object_description')),
        norm(get('group_type_unit')),
        norm(get('vehicle')),
        intOrNull(get('tahun')),
        Math.round(num(get('harga_pasar'))),
      ],
    };
  }

  if (type === 'bq') {
    const cno = contractNo(get('contract_no'));
    const name = norm(get('customer_name'));
    if (!cno || !name) return { ok: false };

    const status = norm(get('status_bq')).toUpperCase();
    return {
      ok: true,
      values: [
        cno, name, phoneNorm(get('phone')), toDate(get('jatuh_tempo')),
        parseInt(num(get('angs_ke')), 10) || 1,
        norm(get('beban_bq')), Math.round(num(get('install_amt'))),
        norm(get('cs_id')), norm(get('nama_mce')), norm(get('cori_grade')),
        norm(get('alamat')), num(get('plafon')),
        Math.round(num(get('overdue'))),
        status || 'BELUM BAYAR',
        norm(get('reason')), toDate(get('janji_bayar')) || norm(get('janji_bayar')),
      ],
    };
  }

  if (type === 'ro') {
    const cno = contractNo(get('contract_no'));
    const name = norm(get('customer_name'));
    if (!cno || !name) return { ok: false };

    return {
      ok: true,
      values: [
        norm(get('cs_id')), norm(get('nama_mce')), name, cno,
        phoneNorm(get('phone')), norm(get('brand')), intOrNull(get('tahun')),
        norm(get('obj_type')), norm(get('obj_code')), norm(get('obj_model')),
        norm(get('obj_desc')), norm(get('no_polisi')), norm(get('cori_grade')),
        parseInt(num(get('sisa_angsuran')), 10) || 1,
      ],
    };
  }

  if (type === 'clop') {
    const cno = contractNo(get('contract_no'));
    if (!cno) return { ok: false };
    return {
      ok: true,
      values: [cno, norm(get('cycle_awal')), norm(get('trend_cycle')).toUpperCase()],
    };
  }

  return { ok: false };
}

/* ------------------------------------------------------------------ *
 * Baca workbook
 * ------------------------------------------------------------------ */

function readWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return wb;
}

function sheetRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
}

/**
 * Pilih sheet yang paling cocok untuk tipe data.
 *
 * Skor header selalu diutamakan: sheet dengan jumlah kolom dikenali
 * terbanyak menang. Nama sheet hanya dipakai sebagai penentu kalau
 * skornya seri — dulu nama "SEARCH OTR" mengalahkan "HARGA PASAR"
 * padahal sheet pertama cuma berisi rumus pencarian, bukan data.
 */
function pickSheet(wb, type, schema, requested) {
  if (requested && wb.SheetNames.includes(requested)) return requested;

  const patterns = {
    otr: /harga\s*pasar/i,
    bq: /booking\s*quality/i,
    ro: /gform|repeat\s*order|data\s*ro/i,
    clop: /clop/i,
  };

  let best = { name: wb.SheetNames[0], score: -1, nameMatch: false };

  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name).slice(0, 15);
    if (!rows.length) continue;

    const hIdx = findHeaderRow(rows, schema);
    const mapped = hIdx >= 0 ? Object.keys(buildColumnMap(rows[hIdx], schema)).length : 0;
    const nameMatch = patterns[type].test(name);

    // Utamakan skor kolom; nama sheet hanya bonus kecil.
    const score = mapped * 10 + (nameMatch ? 5 : 0);

    if (score > best.score) best = { name, score, nameMatch };
  }

  return best.name;
}

/* ------------------------------------------------------------------ *
 * Insert batch (transaksional)
 * ------------------------------------------------------------------ */

function runInsert(db, sql, tuples) {
  return new Promise((resolve, reject) => {
    if (!tuples.length) return resolve({ changed: 0, failed: 0 });

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (e) => {
        if (e) return reject(e);

        const stmt = db.prepare(sql);
        let changed = 0;
        let failed = 0;
        let done = 0;

        tuples.forEach((values) => {
          stmt.run(values, function (err) {
            if (err) failed++;
            else changed += this.changes;
            if (++done === tuples.length) {
              stmt.finalize((fe) => {
                if (fe) return db.run('ROLLBACK', () => reject(fe));
                db.run('COMMIT', (ce) => {
                  if (ce) return db.run('ROLLBACK', () => reject(ce));
                  resolve({ changed, failed });
                });
              });
            }
          });
        });
      });
    });
  });
}

/* ------------------------------------------------------------------ *
 * Endpoint handlers
 * ------------------------------------------------------------------ */

/** GET /api/v1/master/types */
exports.getTypes = (req, res) => {
  res.json({
    success: true,
    data: Object.entries(SCHEMAS).map(([key, s]) => ({
      key,
      label: s.label,
      table: s.table,
      columns: s.columns,
      required: s.required,
    })),
  });
};

/**
 * POST /api/v1/master/import?type=otr|bq|ro|clop&mode=preview|commit&sheet=Nama
 * multipart/form-data, field file = .xlsx / .xls / .csv
 */
exports.importFile = async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const mode = String(req.query.mode || 'preview').toLowerCase();
    const sheetParam = req.query.sheet ? String(req.query.sheet) : '';

    const schema = SCHEMAS[type];
    if (!schema) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TYPE',
        message: `Jenis data tidak dikenal: "${type}". Pilih salah satu: ${Object.keys(SCHEMAS).join(', ')}`,
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        code: 'NO_FILE',
        message: 'File belum diunggah. Gunakan field "file" berisi .xlsx/.xls/.csv.',
      });
    }

    const wb = readWorkbook(req.file.buffer);
    if (!wb.SheetNames.length) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_WORKBOOK',
        message: 'File tidak berisi sheet apa pun.',
      });
    }

    const sheetName = pickSheet(wb, type, schema, sheetParam);
    const rows = sheetRows(wb, sheetName);

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_SHEET',
        message: `Sheet "${sheetName}" kosong.`,
      });
    }

    const headerIdx = findHeaderRow(rows, schema);
    const headerRow = headerIdx >= 0 ? rows[headerIdx] : [];
    const colMap = buildColumnMap(headerRow, schema);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

    // Kalau tidak ada header sama sekali, pakai urutan posisional penuh
    if (headerIdx < 0) {
      schema.positional.forEach((field, i) => {
        if (colMap[field] == null) colMap[field] = i;
      });
    }

    const tuples = [];
    const skipped = [];
    let totalRows = 0;

    for (let i = dataStart; i < rows.length; i++) {
      const raw = rows[i] || [];
      if (raw.every((c) => norm(c) === '')) continue;
      totalRows++;

      const out = transform(type, raw, colMap);
      if (out.ok) {
        tuples.push(out.values);
      } else if (skipped.length < 5) {
        skipped.push({ row: i + 1, reason: `kolom wajib kosong (${schema.required.join(', ')})` });
      }
    }

    const mappedFields = Object.keys(colMap).filter((f) => colMap[f] != null);
    const missingRequired = schema.required.filter((f) => colMap[f] == null);

    const preview = tuples.slice(0, 5).map((values) => {
      const obj = {};
      schema.columns.forEach((c, i) => { obj[c] = values[i]; });
      return obj;
    });

    const base = {
      success: true,
      type,
      label: schema.label,
      sheet: sheetName,
      sheets: wb.SheetNames,
      headerRow: headerIdx >= 0 ? headerIdx + 1 : null,
      mappedColumns: mappedFields,
      missingRequired,
      totalRows,
      validRows: tuples.length,
      skippedRows: totalRows - tuples.length,
      preview,
    };

    if (mode === 'preview') {
      return res.json({ ...base, mode: 'preview', committed: false });
    }

    if (missingRequired.length) {
      return res.status(400).json({
        ...base,
        success: false,
        code: 'MISSING_REQUIRED',
        message: `Kolom wajib tidak ditemukan: ${missingRequired.join(', ')}`,
      });
    }

    const db = getDb();
    const result = await runInsert(db, schema.insert, tuples);

    // Tetapkan pemilik tiap baris.
    // CS ID yang punya akun -> dirinya sendiri.
    // CS ID tanpa akun (data titipan) -> menempel ke supervisor pemegang.
    const ownershipTables = { bq: 'booking_quality', ro: 'repeat_orders' };
    const ownTable = ownershipTables[type];
    if (ownTable) {
      db.run(
        `UPDATE ${ownTable}
            SET owner_cs_id = CASE
                  WHEN cs_id IN (SELECT cs_id FROM users) THEN cs_id
                  WHEN cs_id IS NULL OR TRIM(cs_id) = '' THEN ?
                  ELSE ? END
          `,
        [CUSTODIAN_CS_ID, CUSTODIAN_CS_ID],
        (ownErr) => {
          if (ownErr) console.error('owner_cs_id assign error:', ownErr.message);
        }
      );
    }

    // Catat riwayat upload supaya supervisor bisa lihat kapan terakhir update.
    db.run(
      `INSERT INTO master_import_log
         (type, file_name, sheet, total_rows, valid_rows, committed, cs_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [type, req.file.originalname || '', sheetName, totalRows, tuples.length,
       (req.user && req.user.csId) || ''],
      (logErr) => {
        if (logErr) console.error('master_import_log error:', logErr.message);
      }
    );

    res.json({
      ...base,
      mode: 'commit',
      committed: true,
      inserted: result.changed,
      failed: result.failed,
      message: `${result.changed} baris ${schema.label} tersimpan.`,
    });
  } catch (err) {
    console.error('Master import error:', err.message);
    res.status(500).json({
      success: false,
      code: 'IMPORT_ERROR',
      message: `Gagal membaca file: ${err.message}`,
    });
  }
};

/** GET /api/v1/master/summary — jumlah baris tiap tabel master */
exports.getSummary = (req, res) => {
  const db = getDb();
  const entries = Object.entries(SCHEMAS);
  const out = {};
  let left = entries.length;

  entries.forEach(([key, s]) => {
    db.get(
      `SELECT COUNT(*) AS c FROM ${s.table}`,
      (err, row) => {
        db.get(
          `SELECT created_at, file_name, valid_rows, cs_id
             FROM master_import_log
            WHERE type = ?
            ORDER BY id DESC LIMIT 1`,
          [key],
          (logErr, log) => {
            out[key] = {
              label: s.label,
              table: s.table,
              rows: err ? null : row.c,
              lastImport: logErr || !log ? null : {
                at: log.created_at,
                fileName: log.file_name,
                rows: log.valid_rows,
                by: log.cs_id,
              },
            };
            if (--left === 0) res.json({ success: true, data: out });
          }
        );
      }
    );
  });
};

/**
 * Riwayat upload data master.
 * GET /api/v1/master/history?type=&limit=
 */
exports.getHistory = (req, res) => {
  const { type, limit = 30 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 30, 200);

  const db = getDb();
  const where = type ? ' WHERE type = ?' : '';
  const params = type ? [String(type).toLowerCase()] : [];

  db.all(
    `SELECT id, type, file_name, sheet, total_rows, valid_rows, cs_id, created_at
       FROM master_import_log${where}
      ORDER BY id DESC LIMIT ?`,
    [...params, lim],
    (err, rows) => {
      if (err) {
        console.error('History error:', err.message);
        return res.status(500).json({
          success: false,
          code: 'DB_ERROR',
          message: 'Gagal membaca riwayat upload.',
        });
      }
      res.json({
        success: true,
        data: (rows || []).map((r) => ({
          id: r.id,
          type: r.type,
          fileName: r.file_name,
          sheet: r.sheet,
          totalRows: r.total_rows,
          validRows: r.valid_rows,
          by: r.cs_id,
          at: r.created_at,
        })),
      });
    }
  );
};
