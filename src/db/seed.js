const { getDb, initDb } = require('./database');
const { hashPin } = require('../utils/auth');

// Default users from GAS code.gs
const DEFAULT_USERS = [
  { csId: 'SPV-PARUNG', nama: 'BANI MUNGGARAN (SUPERVISOR)', pin: '123456', role: 'SUPERVISOR', status: 'AKTIF', email: 'spv.parung@gmail.com' },
  { csId: 'S000085752', nama: 'ANNISA CRISNADILLA', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'annisa.marketing@gmail.com' },
  { csId: 'S000068864', nama: 'DEDE LIA SUSANTI', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'dede.marketing@gmail.com' }
];

async function seed() {
  console.log('Initializing database...');
  await initDb();

  const db = getDb();

  for (const user of DEFAULT_USERS) {
    const hash = await hashPin(user.pin);
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO users (cs_id, nama, password_hash, role, status, email, must_change_pin)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [user.csId, user.nama, hash, user.role, user.status, user.email],
        (err) => {
          if (err) {
            console.error(`Error seeding user ${user.csId}:`, err.message);
            reject(err);
          } else {
            console.log(`Seeded user: ${user.csId} (${user.nama})`);
            resolve();
          }
        }
      );
    });
  }

  console.log('Seeding complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
