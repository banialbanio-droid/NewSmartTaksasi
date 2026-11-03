const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'smart_taksasi.db');

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection error:', err.message);
      } else {
        console.log('Connected to SQLite database:', DB_PATH);
      }
    });
  }
  return db;
}

function initDb() {
  return new Promise((resolve, reject) => {
    const database = getDb();

    // Users table
    database.run(`
      CREATE TABLE IF NOT EXISTS users (
        cs_id TEXT PRIMARY KEY,
        nama TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'MARKETING',
        status TEXT DEFAULT 'AKTIF',
        email TEXT,
        failed_attempts INTEGER DEFAULT 0,
        reset_requested INTEGER DEFAULT 0,
        last_login TEXT,
        must_change_pin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) {
        console.error('Error creating users table:', err.message);
        reject(err);
        return;
      }
      console.log('Users table ready');
      // Migrate Firebase UID column for the upcoming Firebase Auth path
      database.run('ALTER TABLE users ADD COLUMN firebase_uid TEXT;', (alterErr) => {
        if (alterErr && !alterErr.message.includes('duplicate column name')) {
          console.error('Error adding firebase_uid column:', alterErr.message);
        } else {
          console.log('firebase_uid column migrated or already exists');
        }
      });
    });

    // OTR Prices table
    database.run(`
      CREATE TABLE IF NOT EXISTS otr_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        object_type TEXT,
        object_description TEXT,
        group_type_unit TEXT,
        vehicle TEXT,
        tahun INTEGER,
        harga_pasar INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE (brand, model, object_type, vehicle, tahun)
      )
    `, (err) => {
      if (err) console.error('Error creating otr_prices table:', err.message);
      else console.log('OTR Prices table ready');
    });

    // CLOP Contracts table
    database.run(`
      CREATE TABLE IF NOT EXISTS clop_contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_no TEXT NOT NULL UNIQUE,
        cycle_awal TEXT,
        trend_cycle TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) console.error('Error creating clop_contracts table:', err.message);
      else console.log('CLOP Contracts table ready');
    });

    // Booking Quality table
    database.run(`
      CREATE TABLE IF NOT EXISTS booking_quality (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_no TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        phone TEXT,
        jatuh_tempo TEXT,
        angs_ke INTEGER DEFAULT 1,
        beban_bq TEXT,
        install_amt INTEGER DEFAULT 0,
        cs_id TEXT,
        nama_mce TEXT,
        cori_grade TEXT,
        alamat TEXT,
        plafon REAL,
        unit_motor TEXT,
        overdue INTEGER DEFAULT 0,
        status_bq TEXT,
        reason TEXT,
        janji_bayar TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) console.error('Error creating booking_quality table:', err.message);
      else console.log('Booking Quality table ready');
    });

    // Repeat Orders table
    database.run(`
      CREATE TABLE IF NOT EXISTS repeat_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cs_id TEXT,
        nama_mce TEXT,
        contract_no TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        phone TEXT,
        cori_grade TEXT,
        brand TEXT,
        tahun INTEGER,
        obj_code TEXT,
        obj_type TEXT,
        obj_model TEXT,
        obj_desc TEXT,
        no_polisi TEXT,
        sisa_angsuran INTEGER DEFAULT 1,
        status_followup TEXT DEFAULT 'BARU',
        catatan TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) {
        console.error('Error creating repeat_orders table:', err.message);
        reject(err);
        return;
      }
      console.log('Repeat Orders table ready');

      // Activity Log table (SPA sync via POST /api/entities/ActivityLog)
      database.run(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cs_id TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT,
          created_date TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `, (err) => {
        if (err) console.error('Error creating activity_log table:', err.message);
        else console.log('Activity Log table ready');
      });

      // Komite table (SPA via /api/komite/*)
      database.run(`
        CREATE TABLE IF NOT EXISTS komite (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cs_id TEXT NOT NULL,
          contract_no TEXT,
          customer_name TEXT,
          status TEXT DEFAULT 'DIAJUKAN',
          catatan TEXT,
          berkas_path TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `, (err) => {
        if (err) console.error('Error creating komite table:', err.message);
        else console.log('Komite table ready');
      });

      // ----------------------------------------------------------------
      // Kolom owner_cs_id: pemilik efektif sebuah baris BQ/Gform.
      //
      // cs_id  = CS ID asli dari file Excel (tidak diubah, untuk jejak).
      // owner_cs_id = siapa yang berhak melihat baris ini:
      //     - CS ID yang terdaftar sebagai user -> dirinya sendiri
      //     - CS ID tanpa akun (data titipan)   -> supervisor pemegang
      //
      // Dengan begitu data tidak pernah yatim: selalu ada yang bertanggung
      // jawab, tapi CS ID asli tetap tersimpan.
      // ----------------------------------------------------------------
      const custodian = process.env.CUSTODIAN_CS_ID || '68343';

      const ownershipMigrations = [
        `ALTER TABLE booking_quality ADD COLUMN owner_cs_id TEXT`,
        `ALTER TABLE repeat_orders ADD COLUMN owner_cs_id TEXT`,
      ];

      let migLeft = ownershipMigrations.length;
      ownershipMigrations.forEach((sql) => {
        database.run(sql, (mErr) => {
          if (mErr && !/duplicate column name/i.test(mErr.message)) {
            console.error('Ownership column error:', mErr.message);
          }
          if (--migLeft === 0) {
            // Isi owner untuk baris yang belum punya.
            database.run(
              `UPDATE booking_quality
                  SET owner_cs_id = CASE
                        WHEN cs_id IN (SELECT cs_id FROM users) THEN cs_id
                        WHEN cs_id IS NULL OR TRIM(cs_id) = '' THEN ?
                        ELSE ? END
                WHERE owner_cs_id IS NULL`,
              [custodian, custodian],
              (e1) => {
                if (e1) console.error('Backfill BQ owner error:', e1.message);
                database.run(
                  `UPDATE repeat_orders
                      SET owner_cs_id = CASE
                            WHEN cs_id IN (SELECT cs_id FROM users) THEN cs_id
                            WHEN cs_id IS NULL OR TRIM(cs_id) = '' THEN ?
                            ELSE ? END
                    WHERE owner_cs_id IS NULL`,
                  [custodian, custodian],
                  (e2) => {
                    if (e2) console.error('Backfill RO owner error:', e2.message);
                    else console.log('Ownership columns ready (custodian: ' + custodian + ')');
                  }
                );
              }
            );
          }
        });
      });

      // Riwayat upload data master (BQ, Gform, CLOP, OTR).
      // Dipakai untuk menampilkan "terakhir diperbarui" ke supervisor.
      database.run(`
        CREATE TABLE IF NOT EXISTS master_import_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          file_name TEXT,
          sheet TEXT,
          total_rows INTEGER DEFAULT 0,
          valid_rows INTEGER DEFAULT 0,
          committed INTEGER DEFAULT 0,
          cs_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `, (logErr) => {
        if (logErr) console.error('Error creating master_import_log table:', logErr.message);
        else console.log('Master import log table ready');
      });

      // Riwayat taksasi yang disimpan marketing
      database.run(`
        CREATE TABLE IF NOT EXISTS taksasi_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cs_id TEXT,
          customer_name TEXT,
          contract_no TEXT,
          brand TEXT,
          model TEXT,
          tahun INTEGER,
          tahun_motor INTEGER,
          km INTEGER,
          otr INTEGER,
          tenor INTEGER,
          plafond INTEGER,
          angsuran INTEGER,
          terima_bersih INTEGER,
          payload TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `, (err) => {
        if (err) console.error('Error creating taksasi_history table:', err.message);
        else console.log('Taksasi History table ready');
      });

      // Indexes for search performance
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_otr_brand ON otr_prices(brand)',
        'CREATE INDEX IF NOT EXISTS idx_otr_model ON otr_prices(model)',
        'CREATE INDEX IF NOT EXISTS idx_otr_tahun ON otr_prices(tahun)',
        'CREATE INDEX IF NOT EXISTS idx_clop_contract ON clop_contracts(contract_no)',
        'CREATE INDEX IF NOT EXISTS idx_bq_contract ON booking_quality(contract_no)',
        'CREATE INDEX IF NOT EXISTS idx_bq_csid ON booking_quality(cs_id)',
        'CREATE INDEX IF NOT EXISTS idx_ro_contract ON repeat_orders(contract_no)',
        'CREATE INDEX IF NOT EXISTS idx_ro_csid ON repeat_orders(cs_id)',
        'CREATE INDEX IF NOT EXISTS idx_activity_log_cs_id ON activity_log(cs_id)',
        'CREATE INDEX IF NOT EXISTS idx_komite_cs_id ON komite(cs_id)',
        'CREATE INDEX IF NOT EXISTS idx_komite_status ON komite(status)'
      ];
      let left = indexes.length;
      indexes.forEach((sql) => {
        database.run(sql, (idxErr) => {
          if (idxErr) console.error('Index error:', idxErr.message);
          left--;
          if (left === 0) resolve();
        });
      });
    });
  });
}

function closeDb() {
  if (db) {
    db.close((err) => {
      if (err) console.error('Error closing database:', err.message);
      else console.log('Database connection closed');
    });
  }
}

module.exports = { getDb, initDb, closeDb };
