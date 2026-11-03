const { getDb, initDb } = require('./database');
const { hashPin } = require('../utils/auth');

// User list from client
const USERS = [
  { csId: '68343', nama: 'BANI MUNGGARAN', pin: '123456', role: 'SUPERVISOR', status: 'AKTIF', email: '68343@fif.co.id' },
  { csId: 'S000085752', nama: 'ANNISA CRISNADILLA', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'S000085752@fif.co.id' },
  { csId: 'S000068864', nama: 'DEDE LIA SUSANTI', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'S000068864@fif.co.id' },
  { csId: 'S000080309', nama: 'MELINDA EKA PUTRI', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'S000080309@fif.co.id' },
  { csId: 'S000119884', nama: 'DZAKIRAH DWI DZAHABIYYAH', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'S000119884@fif.co.id' },
  { csId: 'S000120518', nama: 'MONICA LESTARI', pin: '123456', role: 'MARKETING', status: 'AKTIF', email: 'S000120518@fif.co.id' }
];

async function seed() {
  console.log('Initializing database...');
  await initDb();

  const db = getDb();

  for (const user of USERS) {
    const hash = await hashPin(user.pin);
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO users (cs_id, nama, password_hash, role, status, email, must_change_pin)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [user.csId, user.nama, hash, user.role, user.status, user.email],
        (err) => {
          if (err) {
            console.error(`Error seeding user ${user.csId}:`, err.message);
            reject(err);
          } else {
            console.log(`✓ ${user.csId} - ${user.nama} (${user.role})`);
            resolve();
          }
        }
      );
    });
  }

  console.log('\nSeeding complete! 6 users registered.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
