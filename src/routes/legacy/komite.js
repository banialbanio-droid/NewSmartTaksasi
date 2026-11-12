const express = require('express');
const router = express.Router();

// Compat: SPA expects /api/config?have=<...>
const { getDb } = require('../../db/database');

router.get('/config', (req, res) => {
  try {
    const have = req.query.have || '';
    // Dulu membaca tabel config yang tidak pernah dibuat di database.js,
    // jadi endpoint selalu 500. Sumber kebenaran konstanta ada di
    // taksasiCalculator — pakai itu, tanpa query DB.
    const { KONSTANTA } = require('../../services/taksasiCalculator');
    res.json({
      success: true,
      data: { ...KONSTANTA, have, config: true }
    });
  } catch (err) {
    console.error('Config error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/users/cs-id POST (SPA menghubungi endpoint ini)
router.post('/users/cs-id', (req, res) => {
  try {
    const { email, cs_id } = req.body;
    if (!email && !cs_id) {
      return res.status(400).json({ success: false, message: 'Email atau cs_id wajib diisi.' });
    }

    const db = getDb();
    const sql = email ? 'SELECT cs_id FROM users WHERE email = ?' : 'SELECT cs_id FROM users WHERE cs_id = ?';
    const params = email ? [email] : [cs_id];

    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('CS ID lookup error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal mencari CS ID.' });
      }
      if (!row) {
        return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
      }
      res.json({ success: true, data: { cs_id: row.cs_id } });
    });
  } catch (err) {
    console.error('Users/cs-id error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/followup/:fid PUT (SPA pembaruan status follow up)
router.put('/followup/:fid', (req, res) => {
  try {
    const fid = req.params.fid;
    const { status, note, ts } = req.body;
    if (!fid || !status) {
      return res.status(400).json({ success: false, message: 'fid dan status wajib diisi.' });
    }

    const db = getDb();

    db.run(
      'UPDATE repeat_orders SET status_followup = ?, catatan = ?, updated_at = datetime("now") WHERE contract_no = ?',
      [status, note, fid],
      function (err) {
        if (err) {
          console.error('Followup update error:', err.message);
          return res.status(500).json({ success: false, message: 'Gagal memperbarui follow up.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ success: false, message: 'Follow up tidak ditemukan.' });
        }
        res.json({ success: true, message: 'Follow up berhasil diperbarui.', id: fid });
      }
    );
  } catch (err) {
    console.error('Followup error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/followup GET (SPA sinkronisasi daftar follow up)
router.get('/followup', (req, res) => {
  try {
    const since = req.query.since;
    const db = getDb();

    const sql = since
      ? 'SELECT * FROM repeat_orders WHERE updated_at > ? ORDER BY updated_at ASC'
      : 'SELECT * FROM repeat_orders ORDER BY updated_at ASC';
    const params = since ? [since] : [];

    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Followup list error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar follow up.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Followup GET error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/followup/summary GET (SPA ringkasan follow up)
router.get('/followup/summary', (req, res) => {
  try {
    const db = getDb();
    db.all('SELECT status_followup, COUNT(*) as count FROM repeat_orders GROUP BY status_followup', [], (err, rows) => {
      if (err) {
        console.error('Followup summary error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat ringkasan follow up.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Followup summary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/followup/upload POST (SPA unggah bukti follow up)
router.post('/followup/upload', (req, res) => {
  try {
    // SPA ini mengharapkan multipart/form-data. Middleware harus di-enabled.
    const { rows, batch, offset, last } = req.body;
    const file = req.files?.upload; // tergantung pada pengaturan express-fileupload, dll.
    if (!file) {
      return res.status(400).json({ success: false, message: 'Berkas upload diperlukan.' });
    }

    // Simulasi simpan ke sistem berkas (bukan bagian dari tugas ini)
    const fileName = `followup_${Date.now()}.${file.name.split('.').pop()}`;
    const savePath = `./data/${fileName}`; // direktori upload shared

    // Berikan nama berkas kembali; SPA bisa mengunduhnya.
    res.json({ success: true, message: 'Upload berhasil.', data: { fileName, savePath } });
  } catch (err) {
    console.error('Followup upload error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/master/status GET (SPA status sinkronisasi master)
router.get('/master/status', (req, res) => {
  try {
    const db = getDb();
    const rows = [];
    // Mengambil log aktivitas terakhir (jika ada) - placeholder sederhana
    db.all('SELECT created_at FROM activity_log ORDER BY created_at DESC LIMIT 1', [], (err, rows) => {
      if (err) {
        console.error('Master status error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat status sinkronisasi.' });
      }
      const lastSync = rows && rows[0] ? rows[0].created_at : null;
      res.json({ success: true, data: { lastSync } });
    });
  } catch (err) {
    console.error('Master status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/master/marketing GET (SPA daftar marketing)
router.get('/master/marketing', (req, res) => {
  try {
    const db = getDb();
    db.all('SELECT cs_id, nama, role, email FROM users WHERE role = ?', ['MARKETING'], [], (err, rows) => {
      if (err) {
        console.error('Master marketing error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat data marketing.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Master marketing error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/master/otr/export GET (SPA unduh OTR)
router.get('/master/otr/export', (req, res) => {
  try {
    const db = getDb();
    db.all('SELECT * FROM otr_prices ORDER BY brand, model, tahun', [], (err, rows) => {
      if (err) {
        console.error('Master OTR export error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal mengekspor OTR.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Master OTR export error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/master/:jenis GET (SPA master generik)
router.get('/master/:jenis', (req, res) => {
  try {
    const jenis = req.params.jenis;
    let sql = '';
    if (jenis === 'otr') {
      sql = 'SELECT * FROM otr_prices ORDER BY brand, model, tahun';
    } else if (jenis === 'status') {
      sql = 'SELECT DISTINCT status FROM repeat_orders ORDER BY status';
    } else {
      return res.status(400).json({ success: false, message: 'Jenis master tidak valid.' });
    }
    const db = getDb();
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('Master jenis error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat master.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Master jenis error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite?since= GET (SPA daftar komite)
router.get('/komite', (req, res) => {
  try {
    const since = req.query.since;
    const db = getDb();
    let sql = 'SELECT * FROM komite';
    const params = [];
    if (since) {
      sql += ' WHERE created_at > ?';
      params.push(since);
    }
    sql += ' ORDER BY created_at ASC';
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Komite list error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar komite.' });
      }
      res.json({ success: true, data: rows || [] });
    });
  } catch (err) {
    console.error('Komite GET error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite POST (SPA buat entri komite)
router.post('/komite', (req, res) => {
  try {
    const { cs_id, contract_no, customer_name, status, catatan, berkas_path } = req.body;
    if (!cs_id || !contract_no || !customer_name) {
      return res.status(400).json({ success: false, message: 'cs_id, contract_no, dan customer_name wajib diisi.' });
    }
    const db = getDb();
    const sql = 'INSERT INTO komite (cs_id, contract_no, customer_name, status, catatan, berkas_path) VALUES (?, ?, ?, ?, ?, ?)';
    db.run(sql, [cs_id, contract_no, customer_name, status, catatan, berkas_path], function (err) {
      if (err) {
        console.error('Komite create error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal membuat komite.' });
      }
      const id = this.lastID;
      res.json({ success: true, message: 'Komite berhasil dibuat.', data: { id } });
    });
  } catch (err) {
    console.error('Komite POST error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/:id GET (SPA detail komite)
router.get('/komite/:id', (req, res) => {
  try {
    const id = req.params.id;
    const db = getDb();
    db.get('SELECT * FROM komite WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('Komite detail error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memuat detail komite.' });
      }
      if (!row) {
        return res.status(404).json({ success: false, message: 'Komite tidak ditemukan.' });
      }
      res.json({ success: true, data: row });
    });
  } catch (err) {
    console.error('Komite detail error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/berkas/:id GET (SPA unduh berkas komite)
router.get('/komite/berkas/:id', (req, res) => {
  try {
    const id = req.params.id;
    const db = getDb();
    db.get('SELECT berkas_path FROM komite WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('Komite berkas error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal mengambil berkas komite.' });
      }
      if (!row || !row.berkas_path) {
        return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan.' });
      }
      // Simulasi kirim berkas; SPA ini mengharapkan blob
      const path = require('path');
      const fs = require('fs');
      const fullPath = path.join(__dirname, '../../..', row.berkas_path);
      if (fs.existsSync(fullPath)) {
        res.sendFile(fullPath);
      } else {
        res.status(404).json({ success: false, message: 'Berkas tidak ada di disk.' });
      }
    });
  } catch (err) {
    console.error('Komite berkas GET error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/:id/status PUT (SPA perbarui status komite)
router.put('/komite/:id/status', (req, res) => {
  try {
    const id = req.params.id;
    const { status, catatan } = req.body;
    const db = getDb();
    const sql = 'UPDATE komite SET status = ?, catatan = ?, updated_at = datetime("now") WHERE id = ?';
    db.run(sql, [status, catatan, id], function (err) {
      if (err) {
        console.error('Komite status update error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui status komite.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Komite tidak ditemukan.' });
      }
      res.json({ success: true, message: 'Status komite diperbarui.', data: { id } });
    });
  } catch (err) {
    console.error('Komite status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/:id/komentar POST (SPA catatan komite)
router.post('/komite/:id/komentar', (req, res) => {
  try {
    const id = req.params.id;
    const { note } = req.body;
    const db = getDb();
    const sql = 'UPDATE komite SET catatan = COALESCE(catatan, "") || "\n" || ? WHERE id = ?';
    db.run(sql, [note, id], function (err) {
      if (err) {
        console.error('Komite komentar error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menambahkan komentar.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Komite tidak ditemukan.' });
      }
      res.json({ success: true, message: 'Komentar ditambahkan.', data: { id } });
    });
  } catch (err) {
    console.error('Komite komentar error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/:id/berkas POST (SPA unggah berkas komite)
router.post('/komite/:id/berkas', (req, res) => {
  try {
    const id = req.params.id;
    const file = req.files?.upload;
    if (!file) {
      return res.status(400).json({ success: false, message: 'Berkas upload diperlukan.' });
    }
    const fileName = `komite_${id}_${Date.now()}.${file.name.split('.').pop()}`;
    const savePath = `./data/${fileName}`; // direktori upload shared
    const db = getDb();
    db.run('UPDATE komite SET berkas_path = ? WHERE id = ?', [savePath, id], function (err) {
      if (err) {
        console.error('Komite berkas upload error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan berkas.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Komite tidak ditemukan.' });
      }
      res.json({ success: true, message: 'Berkas diupload.', data: { fileName, savePath } });
    });
  } catch (err) {
    console.error('Komite berkas upload error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/komite/berkas/:id DELETE (SPA hapus berkas komite)
router.delete('/komite/berkas/:id', (req, res) => {
  try {
    const id = req.params.id;
    const db = getDb();
    db.get('SELECT berkas_path FROM komite WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('Komite berkas delete error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menghapus berkas.' });
      }
      if (!row || !row.berkas_path) {
        return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan.' });
      }
      const path = require('path');
      const fs = require('fs');
      const fullPath = path.join(__dirname, '../../..', row.berkas_path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      db.run('UPDATE komite SET berkas_path = NULL WHERE id = ?', [id], function (err) {
        if (err) {
          console.error('Komite berkas delete error (DB):', err.message);
          return res.status(500).json({ success: false, message: 'Gagal menghapus berkas.' });
        }
        res.json({ success: true, message: 'Berkas dihapus.', data: { id } });
      });
    });
  } catch (err) {
    console.error('Komite berkas DELETE error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Compat: /api/entities/ActivityLog POST (SPA log aktivitas taksasi)
router.post('/entities/ActivityLog', (req, res) => {
  try {
    const { action, detail, created_date } = req.body;
    if (!action || !detail) {
      return res.status(400).json({ success: false, message: 'action dan detail wajib diisi.' });
    }
    const db = getDb();
    // Ekstrak cs_id dari detail jika ada, jika tidak null (SPA mengirimkan ringkasan string JSON)
    let csId = null;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.fid) csId = parsed.fid;
    } catch (e) {}

    const sql = 'INSERT INTO activity_log (cs_id, action, detail, created_date) VALUES (?, ?, ?, ?)'
    db.run(sql, [csId, action, detail, created_date], function (err) {
      if (err) {
        console.error('ActivityLog insert error:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan log aktivitas.' });
      }
      res.json({ success: true, message: 'Activity log disimpan.', data: { id: this.lastID } });
    });
  } catch (err) {
    console.error('ActivityLog error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;