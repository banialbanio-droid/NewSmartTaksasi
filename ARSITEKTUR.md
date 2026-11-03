# Arsitektur Aplikasi SMART TAKSASI V3.2

Status: **Draf untuk disetujui**
Tanggal: 1 November 2026
Keputusan pemilik produk: Opsi **A** (WebView + API), **Firebase Auth asli**, **offline hanya Kalkulator**

---

## 1. Kondisi Saat Ini (terverifikasi)

### 1.1 Aplikasi Flutter — ternyata shell WebView

`C:\Users\USER\Downloads\smart-taksasi-flutter\app`

| Komponen | Isi |
|---|---|
| `lib/main.dart` | 73 baris. `InAppWebView` memuat `assets/www/index.html` |
| `assets/www/` | 12 file JS + CSS + HTML, total 261 KB — SPA lama |
| `pubspec.yaml` | `flutter_inappwebview 6.0.0`, `path_provider`, `cupertino_icons` |
| APK | `build/app/outputs/flutter-apk/app-debug.apk` (153 MB, debug) |

**Kesimpulan:** aplikasi ini belum native. Ia membungkus SPA. 17 halaman, semua UI, semua logika bisnis ada di JavaScript.

### 1.2 Backend — Node.js + SQLite

`C:\Users\USER\smart-taksasi-backend` — berjalan di `http://localhost:3000`

| Modul | Isi | Status |
|---|---|---|
| Auth | CS ID + PIN, bcrypt, JWT 6 jam, lockout 3x | Selesai |
| OTR | 4.642 baris | Selesai |
| CLOP | 51.994 baris | Selesai |
| Booking Quality | 198 baris | Selesai |
| Repeat Order | 325 baris | Selesai |
| Kalkulator | 6 endpoint, terverifikasi 36.869 kasus / 0 mismatch | Selesai |

### 1.3 Kesenjangan yang harus dijembatani

| # | Masalah | Bukti |
|---|---|---|
| 1 | **Kontrak API tidak cocok** | `sync.js` memanggil `POST /api/auth/session` (Firebase). Backend punya `POST /api/v1/auth/login` (PIN). |
| 2 | **16 endpoint belum ada di backend** | SPA memanggil `/api/config`, `/api/followup`, `/api/master/*`, `/api/komite`, `/api/users/cs-id`. Backend tidak punya satupun. |
| 3 | **`apiBase` masih placeholder** | `config.js`: `https://GANTI-DENGAN-DOMAIN-SERVER-RESMI` |
| 4 | **`data-harga.js` hilang** | Direferensikan `index.html:494`, file tidak ada. `window.HARGA` dipakai `app.js`. |
| 5 | **Rumus terduplikasi** | `calc.js` (SPA) punya rumus sendiri; backend punya `taksasiCalculator.js` yang terverifikasi. |

---

## 2. Arsitektur Target

```
┌─────────────────────────────────────────────────────────┐
│  Flutter shell (lib/main.dart)                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  InAppWebView  →  assets/www/index.html           │  │
│  │  ├─ SPA 17 halaman (tidak diubah)                 │  │
│  │  ├─ calc.js      → kalkulator offline             │  │
│  │  ├─ sync.js      → Firebase Auth + antrean sync   │  │
│  │  └─ app.js       → UI, fetch via OTRSync.api()    │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS + Bearer Firebase ID Token
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Backend Express  (api.smarttaksasi.id)                 │
│  ├─ middleware/firebaseAuth.js   ← BARU                 │
│  ├─ routes/auth.js               ← POST /api/auth/session│
│  ├─ routes/legacy/               ← 15 endpoint kompat    │
│  │   ├─ config.js  followup.js  master.js               │
│  │   ├─ komite.js  users.js  entities.js                │
│  └─ (endpoint v1 yang sudah ada tetap jalan)            │
└────────────────────────┬────────────────────────────────┘
                         ▼
              SQLite (dev) → PostgreSQL (prod)
```

**Prinsip:** SPA **tidak diubah**. Semua penyesuaian di sisi backend. Ini yang membuat estimasi 2-3 hari realistis.

---

## 3. Autentikasi — Firebase

### 3.1 Alur login

```
1. SPA: email + password → Firebase Identity Toolkit
   POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>
   ← idToken (1 jam) + refreshToken

2. SPA cek klaim email_verified. Jika false → kirim VERIFY_EMAIL, tampilkan pesan.

3. SPA: POST /api/auth/session  (Authorization: Bearer <idToken>)
   ← { user: { id, name, role, cabang, email } }

4. Backend: verifikasi idToken ke Google public keys,
   cocokkan email dengan tabel users, kembalikan role.

5. Token kedaluwarsa tiap 1 jam → SPA refresh otomatis via securetoken.googleapis.com
```

### 3.2 Yang perlu dibangun di backend

**`src/middleware/firebaseAuth.js`**
- Verifikasi JWT Firebase memakai `jose` atau `google-auth-library`
- Ambil `sub`, `email`, `email_verified` dari klaim
- Tolak jika `email_verified !== true` → 403
- Cari user di tabel `users` berdasarkan email
- Tolak jika status bukan `AKTIF` → 403 dengan pesan sesuai status
- Pasang `req.user = { csId, nama, role, email }`

**`POST /api/auth/session`** → `{ user: { id, name, role, cabang, email } }`
- `id` = `cs_id` (SPA memakai ini sebagai kunci antrean)
- `cabang` = `"KIOS PARUNG PANJANG"`

### 3.3 Perubahan skema database

Tabel `users` perlu kolom `firebase_uid`. Migrasi:

```sql
ALTER TABLE users ADD COLUMN firebase_uid TEXT;
CREATE UNIQUE INDEX idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE INDEX idx_users_email ON users(email);
```

PIN tetap disimpan untuk fallback admin, tapi **login marketing lewat Firebase**.

### 3.4 Yang dibutuhkan dari kamu

- Firebase project `eng-object-1n2tx` — aktifkan **Email/Password** di Authentication
- Daftarkan email 9 marketing + 1 supervisor
- Set `email_verified = true` (atau biarkan mereka verifikasi lewat email)
- File **service account JSON** (Project Settings → Service Accounts → Generate new private key)

---

## 4. Endpoint Kompatibilitas (15 buah)

Backend harus menyediakan path yang **sama persis** dengan yang dipanggil SPA.

| Method | Path | Fungsi | Sumber data |
|---|---|---|---|
| POST | `/api/auth/session` | Verifikasi token, kembalikan user | `users` |
| GET | `/api/config?have=` | Konstanta, master marketing | `taksasiCalculator` |
| GET | `/api/master/status` | Status sinkronisasi master | metadata |
| GET | `/api/master/marketing` | Daftar marketing | `users` |
| GET | `/api/master/otr/export` | Unduh OTR (CSV/XLSX) | `otr_prices` |
| GET | `/api/master/:jenis` | Master generik | `otr_prices` |
| GET | `/api/users/cs-id` | Cari CS ID dari email | `users` |
| GET | `/api/followup?since=` | Daftar follow-up | `repeat_orders` |
| PUT | `/api/followup/:fid` | Update status follow-up | `repeat_orders` |
| GET | `/api/followup/summary` | Ringkasan follow-up | `repeat_orders` |
| POST | `/api/followup/upload` | Unggah foto bukti | filesystem |
| GET | `/api/komite?since=` | Daftar komite | tabel baru `komite` |
| POST | `/api/komite` | Buat entri komite | tabel baru `komite` |
| GET | `/api/komite/:id` | Detail komite | tabel baru `komite` |
| GET | `/api/komite/berkas/:id` | Unduh berkas komite | filesystem |
| POST | `/api/entities/ActivityLog` | Catat aktivitas taksasi | tabel baru `activity_log` |

### 4.1 Tabel baru yang dibutuhkan

```sql
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cs_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE komite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cs_id TEXT NOT NULL,
  contract_no TEXT,
  customer_name TEXT,
  status TEXT DEFAULT 'DIAJUKAN',
  catatan TEXT,
  berkas_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 4.2 Pemetaan data

SPA memakai nama field lama. Backend memakai snake_case. Contoh `followup`:

| SPA | Backend |
|---|---|
| `fid` | `contract_no` |
| `status` | `status_followup` |
| `note` | `catatan` |
| `ts` | `updated_at` |

Adaptor ditulis di controller, bukan di SPA.

---

## 5. Strategi Offline

Keputusanmu: **offline hanya untuk Kalkulator.**

| Fitur | Offline | Alasan |
|---|---|---|
| Kalkulator taksasi | ✅ Ya | Marketing hitung di lapangan tanpa sinyal |
| Cari OTR | ❌ Tidak | Butuh 4.642 baris, terlalu besar untuk disinkron awal |
| CLOP | ❌ Tidak | 51.994 baris, butuh server |
| Booking Quality | ❌ Tidak | Data berubah harian |
| Repeat Order | ❌ Tidak | Data berubah harian |

### 5.1 Cara kerja

**`calc.js` sudah offline** — rumusnya ada di file lokal, tidak butuh jaringan. Yang perlu dipastikan:

1. **Tabel rate harus ikut dibundel.** `CALC_REGULER_TABLE` (229 baris) dan `CALC_AWDA_TABLE` (177 baris) disimpan sebagai `assets/www/rate-tables.js`, dihasilkan dari backend via `scripts/extract-tables.js`.
2. **Antrean hasil taksasi** tetap lewat `sync.js` (sudah ada, `localStorage`, maks 2.000 entri). Saat online, dikirim ke `POST /api/entities/ActivityLog`.
3. **Validasi versi tabel.** `/api/config` mengembalikan `versiTabelRate`. Jika berbeda dari bundel, SPA unduh versi baru saat online.

### 5.2 Yang TIDAK dilakukan

- Tidak ada cache OTR lokal (bertentangan dengan keputusanmu)
- Tidak ada service worker
- Tidak ada database lokal di Flutter

---

## 6. Rencana Kerja

### Fase 0 — Persiapan (kamu, ~30 menit)
- [ ] Aktifkan Email/Password di Firebase Console
- [ ] Buat 10 akun (9 marketing + 1 supervisor)
- [ ] Unduh service account JSON
- [ ] Tentukan domain (mis. `api.smarttaksasi.id`) + sertifikat TLS

### Fase 1 — Backend: Firebase Auth (½ hari)
- [ ] `npm i google-auth-library`
- [ ] `src/middleware/firebaseAuth.js`
- [ ] `POST /api/auth/session`
- [ ] Migrasi kolom `firebase_uid`
- [ ] Test: login Firebase → dapat user + role

### Fase 2 — Backend: endpoint kompatibilitas (1 hari)
- [ ] `/api/config`, `/api/master/*`, `/api/users/cs-id`
- [ ] `/api/followup/*` (adaptor ke `repeat_orders`)
- [ ] `/api/entities/ActivityLog` + tabel `activity_log`
- [ ] `/api/komite/*` + tabel `komite`

### Fase 3 — Integrasi SPA (½ hari)
- [ ] Set `apiBase` di `config.js`
- [ ] Bundel `rate-tables.js` ke `assets/www/`
- [ ] Hapus `<script src="data-harga.js">` dari `index.html`
- [ ] Ganti `window.HARGA` → fetch `/api/master/otr`

### Fase 4 — Build & uji (½ hari)
- [ ] `flutter build apk --release`
- [ ] Uji login, kalkulator offline, sync antrean
- [ ] Uji di HP Android sungguhan

**Total: 2,5–3 hari kerja**

---

## 7. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Domain + TLS belum ada | APK tidak bisa konek (Android blokir HTTP) | Fase 0 wajib selesai dulu |
| Firebase service account belum ada | Fase 1 tidak bisa mulai | Minta lebih awal |
| SPA punya bug tersembunyi | Integrasi molor | Uji per halaman, bukan sekaligus |
| `calc.js` beda hasil dengan backend | Angka tidak konsisten | Bandingkan 100 kasus sebelum rilis |
| APK 153 MB (debug) | Tidak layak distribusi | Build release + `--split-per-abi` |
| Data marketing sensitif | Kebocoran | HTTPS wajib, token 1 jam, tidak simpan PII di HP |

---

## 8. Yang TIDAK termasuk fase ini

- Migrasi ke PostgreSQL (nanti, saat produksi)
- App native penuh (opsi B/C, setelah A stabil)
- Push notification
- Fitur baru di luar 17 halaman yang ada

---

## 9. Pertanyaan Terbuka

1. **Domain server** — sudah punya? Kalau belum, pakai Railway/Render dulu untuk uji?
2. **Service account Firebase** — sudah bisa diunduh sekarang?
3. **Email 10 user** — sudah ada daftarnya, atau perlu saya siapkan template?
4. **`data-harga.js`** — file ini hilang. Apakah harga OTR memang mau diambil dari API (rekomendasi saya), atau kamu punya file aslinya?
5. **Komite** — fitur ini ada di SPA (`komite.js`, 22 KB) tapi belum ada di backend. Perlu dipertahankan?
