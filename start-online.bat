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

REM --- Cek cloudflared ---
set CF=%~dp0cloudflared.exe
if not exist "%CF%" (
  echo [..] cloudflared belum ada, mengunduh...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%'"
  if not exist "%CF%" (
    echo [X] Gagal mengunduh cloudflared.
    echo     Unduh manual: https://github.com/cloudflare/cloudflared/releases
    pause
    exit /b 1
  )
  echo [OK] cloudflared siap.
)

REM --- Matikan backend lama di port 3000 ---
echo.
echo [..] Membersihkan port 3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>nul
)
timeout /t 2 >nul

REM --- Backend ---
echo [..] Menyalakan backend...
start "SMART TAKSASI Backend" /min cmd /c "node src\app.js"

echo [..] Menunggu backend siap...
set /a tries=0
:waitloop
timeout /t 2 >nul
set /a tries+=1
curl -s -m 3 http://localhost:3000/health >nul 2>nul
if not errorlevel 1 goto backend_ok
if %tries% geq 10 (
  echo [X] Backend tidak merespons. Jalankan manual: node src\app.js
  pause
  exit /b 1
)
goto waitloop

:backend_ok
echo [OK] Backend hidup di http://localhost:3000
echo.

REM --- Tunnel ---
echo ============================================================
echo   URL PUBLIK (tempel di app -^> Pengaturan -^> Alamat Server)
echo ============================================================
echo.
echo   Tunggu beberapa detik, URL akan muncul di bawah ini.
echo   Bentuknya: https://xxxx-xxxx.trycloudflare.com
echo.
echo   CATATAN: URL berubah setiap kali jendela ini ditutup.
echo ============================================================
echo.

"%CF%" tunnel --url http://localhost:3000 --no-autoupdate

echo.
echo [..] Tunnel berhenti.
pause
