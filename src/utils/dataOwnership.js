/**
 * Kepemilikan data master (BQ & Gform).
 *
 * ATURAN BISNIS
 * -------------
 * 1. Setiap baris BQ/Gform punya `cs_id` (CS ID asli dari Excel) dan
 *    `owner_cs_id` (siapa yang berhak melihat).
 * 2. Hanya CS ID yang TERDAFTAR sebagai user yang bisa login.
 * 3. Baris milik CS ID tanpa akun = "data titipan". Baris itu menempel
 *    ke supervisor pemegang (default 68343) supaya tetap terpakai dan
 *    ada penanggung jawabnya — tapi CS ID aslinya tidak diubah.
 * 4. Marketing hanya melihat baris dengan owner_cs_id = CS ID dirinya.
 * 5. Supervisor melihat semua baris, dan bisa memfilter per marketing
 *    atau khusus "data titipan".
 */

/** CS ID supervisor pemegang data titipan. */
const CUSTODIAN_CS_ID = (process.env.CUSTODIAN_CS_ID || '68343').toUpperCase();

const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();

const isSupervisor = (user) => {
  const role = String(user && user.role).toUpperCase();
  return role === 'SUPERVISOR' || role === 'UNIT HEAD';
};

/** Nilai filter khusus: tampilkan hanya baris yang CS ID-nya tanpa akun. */
const UNASSIGNED = '__UNASSIGNED__';

/**
 * Bangun klausa WHERE untuk tabel ber-owner.
 *
 * @param {object} user         req.user hasil verifikasi JWT
 * @param {string} [csIdFilter] filter opsional dari supervisor
 * @returns {{sql: string, params: Array}}
 */
function ownershipClause(user, csIdFilter) {
  if (isSupervisor(user)) {
    const wanted = norm(csIdFilter);
    if (!wanted) return { sql: '', params: [] };

    if (wanted === UNASSIGNED) {
      // Baris titipan: owner-nya supervisor, tapi CS ID aslinya bukan user.
      return {
        sql: ` AND cs_id IS NOT NULL AND TRIM(cs_id) <> ''
                AND cs_id NOT IN (SELECT cs_id FROM users)`,
        params: [],
      };
    }

    // Filter per marketing memakai owner (termasuk titipan yang jatuh ke dia).
    return { sql: ' AND owner_cs_id = ?', params: [wanted] };
  }

  // Marketing: hanya baris miliknya sendiri, filter apa pun diabaikan.
  return { sql: ' AND owner_cs_id = ?', params: [norm(user.csId)] };
}

/**
 * Boleh tidak user melihat satu baris.
 * Dipakai endpoint detail/update (cek satu kontrak).
 */
function canSeeRow(user, row) {
  if (isSupervisor(user)) return true;
  const owner = row && row.owner_cs_id;
  const ownId = norm(user.csId);
  if (owner) return norm(owner) === ownId;
  // Baris lama tanpa owner: jatuh ke pencocokan cs_id.
  return norm(row && row.cs_id) === ownId;
}

/**
 * Owner efektif untuk sebuah CS ID asli.
 * Dipakai saat import: kalau CS ID-nya belum punya akun, titipkan ke supervisor.
 *
 * @param {string} rawCsId           CS ID dari file Excel
 * @param {Set<string>} knownUsers   daftar CS ID yang punya akun
 */
function resolveOwner(rawCsId, knownUsers) {
  const id = norm(rawCsId);
  if (!id) return CUSTODIAN_CS_ID;
  return knownUsers.has(id) ? id : CUSTODIAN_CS_ID;
}

/** Query CS ID yang punya data tapi tanpa akun (untuk layar Kelola User). */
function unlinkedSql(table) {
  return `SELECT cs_id,
                 MAX(nama_mce) AS nama,
                 COUNT(*)      AS jumlah
            FROM ${table}
           WHERE cs_id IS NOT NULL AND TRIM(cs_id) <> ''
             AND cs_id NOT IN (SELECT cs_id FROM users)
           GROUP BY cs_id
           ORDER BY jumlah DESC`;
}

module.exports = {
  CUSTODIAN_CS_ID,
  UNASSIGNED,
  isSupervisor,
  ownershipClause,
  canSeeRow,
  resolveOwner,
  unlinkedSql,
  norm,
};
