const s = require('sqlite3');
const db = new s.Database('./src/db/smart_taksasi.db');

db.all('PRAGMA table_info(marketing_targets)', (e, r) => {
  console.log('=== kolom marketing_targets ===');
  if (e) console.log('ERR', e.message);
  else console.log(r.map((x) => x.name).join(', '));

  db.all("SELECT name FROM sqlite_master WHERE type='table'", (e2, r2) => {
    console.log('\n=== semua tabel ===');
    if (e2) console.log('ERR', e2.message);
    else console.log(r2.map((x) => x.name).join(', '));
    db.close();
  });
});
