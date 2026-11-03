/**
 * Backup database SQLite.
 *
 * Pakai: node scripts/backup-db.js
 *
 * Menyimpan salinan ke backups/smart_taksasi_YYYY-MM-DD_HHmm.db dan
 * menghapus backup lebih lama dari 30 hari supaya disk tidak penuh.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'src', 'db', 'smart_taksasi.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = 30;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[X] Database tidak ditemukan: ${DB_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const name = `smart_taksasi_${stamp()}.db`;
  const target = path.join(BACKUP_DIR, name);

  fs.copyFileSync(DB_PATH, target);

  const size = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
  console.log(`[OK] Backup dibuat: backups/${name} (${size} MB)`);

  // Hapus backup lama.
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }

  if (removed > 0) console.log(`[OK] ${removed} backup lama dihapus (> ${RETENTION_DAYS} hari).`);

  const total = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).length;
  console.log(`[i] Total backup tersimpan: ${total}`);
}

main();
