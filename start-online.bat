@echo off
REM ============================================================
REM  SMART TAKSASI - Jalankan Backend + Akses Internet
REM ============================================================
REM  Skrip ini:
REM   1. Menyalakan backend Node (port 3000)
REM   2. Membuka tunnel Cloudflare supaya app bisa diakses
REM      dari jaringan mana pun (tidak perlu WiFi yang sama)
REM   3. Menampilkan URL publik yang harus dimasukkan di app
REM
REM  Cara pakai: klik dua kali file ini.
REM  Tutup jendela ini = backend + tunnel mati.
REM ============================================================

title SMART TAKSASI - Backend + Tunnel
cd /d "%~dp0"

echo.
echo ============================================================
echo   SMART TAKSASI - Backend + Akses Internet
echo ============================================================
echo.

REM --- Cek node ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js tidak ditemukan.
  echo     Install dulu dari https://nodejs.org
  pause
  exit /b 1
)

REM --- Jalankan semuanya lewat online.js ---
REM Script itu: matikan backend lama, nyalakan backend, buka tunnel,
REM lalu cetak URL publiknya dengan jelas.
node scripts\online.js

echo.
echo [..] Selesai.
pause
