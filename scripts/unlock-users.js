const { getDb } = require('../src/db/database');
const db = getDb();

// Tampilkan kondisi semua akun dulu.
db.all(
  'SELECT cs_id, nama, role, status, failed_attempts FROM users ORDER BY role, cs_id',
  (e, rows) => {
    if (e) { console.log('ERR:', e.message); return; }

    console.log('=== KONDISI AKUN SEBELUM ===');
    for (const r of rows) {
      console.log(
        `${r.cs_id.padEnd(14)} ${String(r.role).padEnd(11)} ` +
        `status=${r.status} gagal=${r.failed_attempts}  ${r.nama}`
      );
    }

    // Buka semua akun yang terkunci dan nolkan hitungan salah PIN.
    db.run(
      "UPDATE users SET status='AKTIF', failed_attempts=0 WHERE status!='AKTIF' OR failed_attempts>0",
      function (err) {
        if (err) { console.log('ERR update:', err.message); return; }
        console.log(`\n=== DIBUKA: ${this.changes} akun ===`);

        db.all(
          'SELECT cs_id, nama, role, status, failed_attempts FROM users ORDER BY role, cs_id',
          (e2, rows2) => {
            if (e2) { console.log('ERR:', e2.message); return; }
            console.log('\n=== KONDISI SETELAH ===');
            for (const r of rows2) {
              console.log(
                `${r.cs_id.padEnd(14)} ${String(r.role).padEnd(11)} ` +
                `status=${r.status} gagal=${r.failed_attempts}  ${r.nama}`
              );
            }
          }
        );
      }
    );
  }
);
