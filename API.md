# SMART TAKSASI V3.2 — Backend API

Node.js + Express + SQLite backend untuk aplikasi mobile SMART TAKSASI V3.2.
Menggantikan Google Apps Script + Google Sheets dengan REST API.

## Status

| Komponen | Status |
|---|---|
| Auth (login, JWT, lockout, status akun) | Selesai |
| Migrasi data (OTR, CLOP, BQ, RO) | Selesai |
| Endpoint OTR / Harga Pasar | Selesai |
| Endpoint CLOP | Selesai |
| Endpoint Booking Quality | Selesai |
| Endpoint Repeat Order | Selesai |
| Rumus taksasi (kalkulator) | Selesai — terverifikasi 36.869 kasus, 0 mismatch |
| App mobile (Android/iOS) | Belum |
| Deployment production | Belum |

## Menjalankan

```bash
npm install
npm run migrate        # migrasi Excel -> SQLite (idempotent)
npm run seed           # 3 user default
npm start              # http://localhost:3000
npm run test:api       # smoke test endpoint data
npm run test:taksasi   # smoke test + verifikasi silang kalkulator
npm run verify:calc    # verifikasi rumus vs index.html (36.869 kasus)
```

## Isi Database

| Tabel | Baris | Sumber |
|---|---|---|
| `users` | 3 | seed (dari GAS) |
| `otr_prices` | 4.642 | HARGA PASAR |
| `clop_contracts` | 51.994 | BAHAN CLOP HO |
| `booking_quality` | 198 | BOOKING QUALITY |
| `repeat_orders` | 325 | BAHAN GFORM |

Semua tabel punya UNIQUE constraint pada natural key, jadi `npm run migrate`
aman dijalankan berulang tanpa membuat duplikat.

## Auth

`POST /api/v1/auth/login` → `{ success, token, user }`
Token JWT berlaku 6 jam (`SESSION_TTL_SECONDS=21600`).
Salah PIN 3x → akun TERKUNCI (`MAX_LOGIN_ATTEMPTS=3`).
Status non-AKTIF ditolak dengan pesan spesifik (PENDING / LOCKED / REJECTED / DISABLED).

Semua endpoint di bawah butuh header:
```
Authorization: Bearer <token>
```

## Endpoint

### Auth
| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/v1/auth/login` | `{ csId, pin }` |
| GET | `/api/v1/auth/validate` | cek sesi |
| POST | `/api/v1/auth/logout` | |
| POST | `/api/v1/auth/change-pin` | `{ oldPin, newPin }` |

### OTR / Harga Pasar
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/otr/search` | `?brand=&model=&tahun=&limit=&offset=` |
| GET | `/api/v1/otr/:id` | detail |
| GET | `/api/v1/otr/brands/list` | 20 brand |
| GET | `/api/v1/otr/brands/:brand/models` | model per brand |

### CLOP
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/clop/check/:contractNo` | cek kontrak → `cycleAwal`, `trendCycle`, `eligible` |
| GET | `/api/v1/clop/search` | `?q=&trend=&limit=&offset=` |
| GET | `/api/v1/clop/stats` | distribusi trend cycle |

`eligible = true` bila `trendCycle === 'ABADI'` (kontrak tidak pernah CLOP).

### Booking Quality
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/booking-quality` | `?status=&search=&limit=&offset=` |
| GET | `/api/v1/booking-quality/:contractNo` | detail |
| PUT | `/api/v1/booking-quality/:contractNo` | `{ statusBq, reason, janjiBayar }` |
| GET | `/api/v1/booking-quality/stats/summary` | ringkasan per status |

Status valid: `BELUM BAYAR`, `SUDAH BAYAR`, `JANJI BAYAR`, `TIDAK BISA DIHUBUNGI`, `LUNAS`, `BATAL`.

### Repeat Order
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/repeat-order` | `?status=&search=&limit=&offset=` |
| GET | `/api/v1/repeat-order/:contractNo` | detail |
| PUT | `/api/v1/repeat-order/:contractNo` | `{ statusFollowup, catatan }` |
| GET | `/api/v1/repeat-order/stats/summary` | ringkasan per status |

Status valid: `BARU`, `DIHUBUNGI`, `MINAT`, `TIDAK MINAT`, `SUDAH RO`, `TIDAK BISA DIHUBUNGI`.

### Taksasi (Kalkulator)

| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/v1/taksasi/hitung` | perhitungan lengkap |
| POST | `/api/v1/taksasi/bandingkan-tenor` | angsuran semua tenor |
| GET | `/api/v1/taksasi/angsuran` | `?plafond=&tenor=&tipe=Reguler\|Awda` |
| GET | `/api/v1/taksasi/persen-taksasi` | `?km=&tahunMotor=` |
| GET | `/api/v1/taksasi/tenor-options` | `?tahunMotor=` |
| GET | `/api/v1/taksasi/config` | konstanta + matriks customer |

**Body `POST /taksasi/hitung`:**

```json
{
  "otr": 15000000,
  "tipeCustomer": "New Customer",
  "cori": "Good",
  "merkMotor": "Honda",
  "segaris": true,
  "lamaPajakMati": 0,
  "kalengMati": false,
  "fakturAda": true,
  "tenor": 12,
  "meteraiCount": 0,
  "topUp": false,
  "km": "",
  "tahunMotor": 2020,
  "plafondOverride": 0
}
```

**Response** memuat: `totalPotongan`, `persenTaksasi`, `hargaTaksasi`, `otrEfektif`,
`ratio`, `angsuranType`, `plafond`, `admin`, `angsuran`, `war`, `meterai`,
`terimaBersih`, `risk`, `plafondOptions` (12 opsi), `tenorOptions`.

### Rumus Taksasi — Urutan Perhitungan

1. **Total potongan** = pajak mati bertingkat + (kaleng mati ? 470.000) + (tanpa faktur ? 500.000)
   - Pajak mati: 1 thn=350rb, 2=650rb, 3=950rb, 4=1,25jt, 5=1,55jt, 6=1,85jt, 7=2,15jt, 8+=2,45jt
2. **% taksasi** dari matriks depresiasi (KM vs KM wajar per umur kendaraan).
   KM kosong/0 atau di bawah KM wajar → **100%**.
3. **Harga taksasi** = OTR × % taksasi
4. **OTR efektif** = harga taksasi − total potongan
5. **Jenis angsuran & rasio** dari matriks tipe customer × merk × posisi BPKB
6. **Plafond** = floor(OTR efektif × rasio / 250.000) × 250.000, minimum 3.250.000
7. **Angsuran** = lookup tabel rate (Reguler/Awda) pada plafond & tenor
8. **WAR** = plafond × (Reguler 0,54 / Awda 0,65)
9. **Terima bersih** = plafond − sisa angsuran − denda − biaya top up − meterai

**Batas tenor** = 36 − (tahun sekarang − tahun motor), dijepit ke 6–36 bulan.

### Verifikasi Akurasi

`npm run verify:calc` mengekstrak fungsi `HSe` asli dari `index.html` lalu
membandingkannya dengan port Node:

```
Kasus diuji       : 36.869
Field dibandingkan: 774.249
Mismatch          : 0
```

`npm run test:taksasi` melakukan hal yang sama lewat HTTP endpoint (576 kasus, 11.520 field, 0 mismatch).

**Kalau rumus diubah**, jalankan kedua script itu. Jangan pernah mengubah
`src/services/taksasiCalculator.js` tanpa verifikasi ulang.

## Otorisasi Data

- **SUPERVISOR** — melihat & mengubah semua data.
- **MARKETING** — hanya data dengan `cs_id` miliknya. Akses kontrak orang lain → `403 FORBIDDEN`.

## Catatan Migrasi

Beberapa hal yang berbeda dari asumsi awal dan sudah ditangani:

- **BAHAN GFORM hanya 13 kolom**, bukan 16. Urutannya:
  `CS ID, MARKETING, NAMA KONSUMEN, NO KONTRAK, NO HP, TAHUN UNIT, OBJ_TYPE, OBJ_CODE, OBJ_MODEL, OBJ_DESC, NOPOL, TIPE CORI, SISA TENOR`.
  Tidak ada kolom brand — `brand` diisi string kosong.
- **BOOKING QUALITY 16 kolom** (GAS `COL_BQ` hanya 15). Kolom ke-12 adalah
  `DAYS PAST DUE` (angka negatif), bukan unit motor.
- **`Jatuh_Tempo` berupa Excel serial date** (mis. 46299) — dikonversi ke `YYYY-MM-DD`.
- **20 baris OTR tidak punya brand** (TIGER SH/DH) — tetap dimasukkan dengan
  `brand = ''` karena model & harga valid.
- **120 duplikat contract_no di CLOP** dan **12 di GFORM** memang ada di Excel;
  dibuang oleh UNIQUE constraint.

## Selanjutnya

1. App mobile (Android/iOS) — backend siap dipakai.
2. Migrasi SQLite → PostgreSQL untuk production.
3. Simpan riwayat taksasi ke database (tabel `taksasi_history`) untuk fitur Rekap Taksasi.
4. Endpoint admin user management (approve/reject/reset PIN) — logika sudah ada di GAS.
