# Cara Membuat Aplikasi Bisa Diakses dari Jaringan Mana Saja

> **Paling gampang: tidak perlu mengisi apa pun.**
> Aplikasi sekarang mencari server sendiri. Saat backend menyala, ia
> mengumumkan alamatnya ke papan pengumuman publik (ntfy.sh), dan app
> membacanya. Jadi walau URL tunnel berubah setiap restart, app tetap
> menemukannya — pengguna hanya perlu login.

Backend berjalan di PC ini. Supaya HP bisa menghubunginya **tanpa harus satu
WiFi**, backend harus punya alamat yang bisa dijangkau dari internet.

Ada tiga pilihan, dari yang paling praktis:

---

## Pilihan 1 — Tailscale Funnel (URL PERMANEN, gratis) ⭐ disarankan

Tailscale sudah terpasang dan login di PC ini, jadi tinggal satu langkah.

**Sekali saja:**

1. Buka link aktivasi ini di browser:

   ```
   https://login.tailscale.com/f/funnel?node=nomLdpFHfh11CNTRL
   ```

2. Klik **Enable Funnel**.

**Setiap kali mau dipakai:**

```bash
cd C:/Users/USER/smart-taksasi-backend
node scripts/online.js --backend      # nyalakan backend
"C:/Program Files/Tailscale/tailscale.exe" funnel --bg 3000
```

Alamat permanen yang didapat:

```
https://yka7sm.tail6c0127.ts.net
```

Alamat ini **tidak pernah berubah**. Tempel sekali di app → Pengaturan →
Alamat Server, selesai. Tidak perlu app Tailscale di HP, karena Funnel
membuka akses ke internet publik (HTTPS).

**Kelebihan:** alamat tetap, HTTPS, tanpa app tambahan di HP.
**Kekurangan:** PC harus menyala.

---

## Pilihan 2 — Tunnel Cloudflare (otomatis, tanpa isi alamat)

> **Catatan penting (batas 429).** Cloudflare membatasi pembuatan quick
> tunnel tanpa akun per alamat IP. Kalau muncul
> `quick tunnel provisioning failed with status 429`, itu batas dari
> Cloudflare, bukan bug. Skrip sekarang otomatis beralih ke tunnel cadangan
> (Pinggy, lalu localtunnel) supaya tim tetap bisa kerja. Untuk alamat
> permanen tanpa batas, pakai **named tunnel** — lihat
> [CLOUDFLARE-TUNNEL.md](CLOUDFLARE-TUNNEL.md).

```bash
cd C:/Users/USER/smart-taksasi-backend
node scripts/online.js
```

Atau klik dua kali `start-online.bat`.

Script akan mencetak URL seperti:

```
https://pricing-hiv-dramatic-yacht.trycloudflare.com
```

URL itu **juga diumumkan otomatis** ke papan pengumuman, jadi app akan
menemukannya sendiri walaupun URL berubah setiap restart. Pengguna tidak
perlu mengetik apa pun.

**Kelebihan:** tidak perlu akun apa pun, langsung jalan, alamat dicari
otomatis.
**Kekurangan:** butuh ~20-30 detik saat backend baru dinyalakan sebelum
tunnel siap; PC harus menyala.

---

## Pilihan 3 — Tailscale biasa (HP perlu app Tailscale)

Kalau HP juga dipasang Tailscale dan login akun yang sama, alamat PC:

```
http://100.123.135.6:3000
```

Alamat ini permanen dan **hanya bisa diakses perangkat di akun Tailscale
kamu** — lebih aman daripada Funnel yang terbuka ke publik.

**Kelebihan:** permanen, privat, tidak butuh aktivasi Funnel.
**Kekurangan:** harus install app Tailscale di setiap HP yang dipakai.

---

## Yang sudah diperbaiki di aplikasi

Supaya tetap jalan di jaringan apa pun, aplikasi sekarang:

| Perbaikan | Kenapa penting |
|---|---|
| **Izin INTERNET di manifest utama** | Sebelumnya hanya ada di manifest debug. Build release tidak bisa akses jaringan sama sekali. |
| **Network security config** | Android 9+ memblokir HTTP biasa. Tanpa ini mode WiFi lokal tidak pernah berfungsi. |
| **Failover berlapis** | App mencoba: alamat publik → tunnel → IP LAN terakhir → kandidat IP LAN. Kalau satu mati, pindah otomatis. |
| **Retry otomatis 3x** | Sinyal lapangan naik-turun. Timeout sesaat tidak langsung jadi error merah. |
| **Timeout 20 detik** | Tanpa timeout, request bisa menggantung selamanya dan layar berputar terus. |
| **Cache offline** | `OfflineCache` sudah ada tapi tidak pernah dipakai. Sekarang BQ & Gform menyimpan data terakhir dan menampilkannya saat offline, dengan banner "Mode offline". |
| **Pesan error manusiawi** | "Connection refused" jadi "Server menolak koneksi. Pastikan backend menyala." |
| **Tombol Periksa Koneksi** | Di Pengaturan, untuk menguji ulang semua alamat tanpa restart app. |

---

## Ringkasan cepat

| Mau | Pakai |
|---|---|
| Sekali set, alamat tidak berubah | **Tailscale Funnel** (Pilihan 1) |
| Cepat, tanpa akun | Tunnel Cloudflare (Pilihan 2) |
| Paling privat | Tailscale di HP (Pilihan 3) |
| Tidak ada internet sama sekali | App tetap jalan dengan data cache |

**Catatan:** semua pilihan butuh PC menyala, karena backend dan database ada
di PC. Kalau nanti ingin benar-benar tanpa PC, backend harus dipindah ke
server cloud — itu pekerjaan terpisah.
