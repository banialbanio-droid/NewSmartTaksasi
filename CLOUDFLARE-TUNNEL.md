# Cloudflare Tunnel: Backend Lokal Tetap Bisa Diakses dari Mana Saja

> **Jawaban singkat: bisa.** Backend tetap berjalan di PC ini (port 3000,
> SQLite lokal). Cloudflare Tunnel hanya membuat "pintu depan" HTTPS ke PC
> itu, jadi HP di jaringan mana pun bisa masuk tanpa IP publik, tanpa
> port forwarding, tanpa memindahkan database.

---

## Cara kerjanya

```
HP tim  ──HTTPS──►  Cloudflare  ──tunnel keluar──►  PC ini
                                                    └─ Node :3000
                                                    └─ SQLite lokal
```

Yang penting dipahami: **koneksi dibuka dari PC keluar ke Cloudflare**, bukan
Cloudflare masuk ke PC. Karena itu tidak perlu buka port di router, tidak
perlu IP statis, dan tidak perlu matikan firewall.

Semua data tetap di PC. Cloudflare hanya meneruskan permintaan; isi database
tidak disimpan di sana.

---

## Cara pakai (yang sudah terpasang)

```bash
cd C:/Users/USER/smart-taksasi-backend
node scripts/online.js
```

Atau klik dua kali `start-online.bat`.

Skrip akan:

1. Menyalakan backend di port 3000 (kalau belum jalan).
2. Membuka tunnel Cloudflare.
3. Menunggu sampai alamatnya benar-benar hidup (`GET /health` = 200).
4. Mengumumkan alamat ke papan pengumuman (ntfy.sh).
5. Memantau tiap 60 detik — kalau mati, buka tunnel baru otomatis.

Aplikasi menemukan alamatnya sendiri lewat papan pengumuman itu. **Pengguna
tidak perlu mengetik apa pun** — cukup buka app dan login.

Tutup jendela = backend + tunnel mati.

---

## Penting: batas quick tunnel tanpa akun

Cloudflare membatasi pembuatan quick tunnel tanpa akun **per alamat IP**.
Kalau batas tercapai, cloudflared membalas:

```
quick tunnel provisioning failed with status 429
```

Ini bukan bug aplikasi. PC ini pernah membuat 2.000+ tunnel saat pengujian,
jadi IP-nya kena batas. Tiga cara menanganinya:

### 1. Pakai akun Cloudflare (paling benar, gratis)

Quick tunnel tanpa akun memang hanya untuk percobaan. Untuk pemakaian harian,
buat **named tunnel** — alamatnya permanen dan tidak kena batas 429:

```bash
cloudflared tunnel login                    # sekali saja, buka browser
cloudflared tunnel create smart-taksasi     # sekali saja
cloudflared tunnel route dns smart-taksasi taksasi.domainanda.com
```

Lalu jalankan:

```bash
cloudflared tunnel run --url http://127.0.0.1:3000 smart-taksasi
```

Butuh domain di Cloudflare (bisa domain murah). Setelah ini alamatnya
**tidak pernah berubah** dan tidak ada rate limit.

### 2. Tunggu batasnya pulih

Batas 429 biasanya pulih dalam hitungan jam sampai sehari. Skrip `online.js`
sudah diperbaiki: kalau kena 429, ia **tidak lagi** mencoba ulang tiap 10
detik (itu justru memperpanjang pembatasan). Sekarang ia beralih ke tunnel
cadangan dan menunggu dengan jeda yang makin panjang (30 detik → 1 menit →
2 menit → maksimal 15 menit).

### 3. Pakai tunnel cadangan (otomatis)

`online.js` sekarang mencoba berurutan:

| Urutan | Layanan | Alamat | Catatan |
|---|---|---|---|
| 1 | Cloudflare quick tunnel | `*.trycloudflare.com` | Utama, gratis, tanpa akun |
| 2 | Pinggy (SSH) | `*.run.pinggy-free.link` | Tanpa akun, berlaku 60 menit |
| 3 | localtunnel | `*.loca.lt` | Tanpa akun, tidak selalu stabil |

Cadangan dipakai **hanya** kalau Cloudflare menolak. Alamatnya tetap
diumumkan otomatis, jadi app tetap menemukannya.

> Pinggy gratis berdurasi 60 menit. Untuk kerja seharian, pakai named tunnel
> Cloudflare (cara 1).

---

## Alamat permanen tanpa Cloudflare: Tailscale Funnel

Kalau tidak ingin bergantung pada Cloudflare sama sekali, Tailscale Funnel
memberi alamat HTTPS permanen:

```bash
# sekali saja: aktifkan Funnel di dashboard Tailscale
tailscale funnel --bg 3000
```

Alamatnya `https://<nama-pc>.<tailnet>.ts.net` dan tidak pernah berubah.
Catatan: Tailscale **tidak terpasang** di PC ini saat dokumentasi ditulis —
`C:\Program Files\Tailscale` tidak ada. Kalau mau jalur ini, install dulu:

```bash
winget install Tailscale.Tailscale
```

---

## Keamanan

Backend sudah punya lapisan yang tetap berlaku lewat tunnel:

| Lapisan | Status |
|---|---|
| HTTPS | Ya — Cloudflare/Pinggy menerminasi TLS |
| JWT | Ya — token wajib untuk endpoint data |
| PIN + batas percobaan | Ya — 3x salah = akun terkunci |
| Rate limit login | Ya — `express-rate-limit` |
| Helmet (header keamanan) | Ya |
| CORS | Ya |

Yang perlu diperhatikan: alamat tunnel **terbuka ke internet publik**. Siapa
pun yang tahu URL-nya bisa mencapai halaman login. Karena itu:

- Jangan bagikan URL tunnel di grup publik.
- Pastikan PIN tidak sederhana (bukan `123456`, bukan tanggal lahir).
- Kalau ada indikasi bocor, matikan tunnel dan buka yang baru.

Papan pengumuman ntfy (`taksasi-srv-8k2m9x4q7v1n6p3w`) juga publik — siapa
pun yang tahu nama topik bisa melihat alamat server. Ini disengaja supaya app
bisa menemukan server tanpa konfigurasi, dan login tetap dilindungi PIN.
Kalau ini terlalu terbuka, ganti nama topik di **dua** tempat:

- `scripts/online.js` → `DISCOVERY_TOPIC`
- `lib/services/discovery_service.dart` → `topic`

Lalu build ulang APK.

---

## Kalau macet

| Gejala | Penyebab | Solusi |
|---|---|---|
| `status 429` | Batas quick tunnel per IP | Named tunnel (cara 1) atau tunggu |
| Alamat terbit tapi HTTP 000 | DNS Cloudflare belum terbit | Tunggu 15-60 detik; skrip sudah menunggu sampai 90 detik |
| HTTP 530 | Tunnel hidup tapi koneksi ke PC putus | Pastikan backend jalan: `curl http://127.0.0.1:3000/health` |
| HTTP 502 | Backend mati atau salah port | Jalankan `node src/app.js` |
| App tidak menemukan server | Pengumuman ntfy kedaluwarsa (12 jam) | Backend harus menyala agar mengumumkan ulang |
| Tunnel mati tiap ~60 menit | Pinggy gratis | Pakai named tunnel Cloudflare |

Cek cepat status:

```bash
curl -s http://127.0.0.1:3000/health          # backend lokal
curl -s "$(cat tunnel-url.txt)/health"        # lewat tunnel
```

---

## Ringkasan

| Mau | Pakai |
|---|---|
| Coba cepat hari ini | `node scripts/online.js` (Cloudflare → Pinggy → localtunnel) |
| Alamat permanen, produksi | Named tunnel Cloudflare + domain |
| Tanpa Cloudflare | Tailscale Funnel |
| Tanpa internet sama sekali | App jalan dengan cache offline |

**Yang tidak berubah:** backend dan database tetap di PC ini. Cloudflare
hanya jalur masuknya.
