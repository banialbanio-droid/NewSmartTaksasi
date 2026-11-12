<?php
/**
 * SMART TAKSASI — Cek Koneksi Server
 *
 * Skrip sederhana ini memverifikasi:
 * 1. Backend di komputer PC berjalan?
 * 2. Firewall memungkinkan akses dari luar?
 * 3. Alamat server yang bisa diakses (LAN / Remote)?
 *
 * Jalankan: php cek_koneksi.php
 * Atau: curl -s http://your-server/php/cek_koneksi.php
 */

// Timeout untuk setiap probe (detik)
define('TIMEOUT', 3);

echo "=== SMART TAKSASI — Cek Koneksi Server ===\n";
echo "Dijalankan: " . date('Y-m-d H:i:s') . "\n";
echo "IP PC: " . getHostByName(gethostname()) . "\n";
echo "==========================================\n\n";

// --- 1. Cek backend lokal ---
echo "[1] Backend di localhost:3000\n";
$ch = curl_init('http://localhost:3000/health');
curl_setopt($ch, CURLOPT_TIMEOUT, TIMEOUT);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$local = curl_exec($ch);
$localCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($localCode == 200) {
    echo "    OK: Backend berjalan (HTTP 200)\n";
} else {
    echo "    GAGAL: HTTP " . $localCode . "\n";
}

// --- 2. Cek port 3000 dari luar (via ntfy.sh) ---
echo "\n[2] Deteksi alamat server (ntfy.sh)...\n";
$topic = 'taksasi-srv-8k2m9x4q7v1n6p3w';
$url = "https://ntfy.sh/$topic";
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_TIMEOUT, TIMEOUT);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, "server-alive");
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: text/plain']);
$ntfy = curl_exec($ch);
$ntfyCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($ntfyCode == 200) {
    echo "    OK: Papan pengumuman berhasil diakses\n";
} else {
    echo "    GAGAL: HTTP " . $ntfyCode . "\n";
}

// --- 3. Cek alamat remote (Pinggy / Cloudflare) ---
echo "\n[3] Alamat remote (jika tersedia)...\n";
$remoteUrl = getenv('REMOTE_URL') ?: 'https://tgmvl-182-2-165-191.run.pinggy-free.link';

$ch = curl_init($remoteUrl . '/health');
curl_setopt($ch, CURLOPT_TIMEOUT, TIMEOUT);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$remote = curl_exec($ch);
$remoteCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($remoteCode == 200) {
    echo "    OK: Remote server hidup (HTTP 200)\n";
    echo "    Alamat: $remoteUrl\n";
} else {
    echo "    GAGAL: HTTP " . $remoteCode . "\n";
    echo "    Alamat: $remoteUrl\n";
}

// --- 4. Verifikasi firewall port 3000 ---
echo "\n[4] Verifikasi firewall port 3000 (Windows):\n";
$rule = shell_exec('netsh advfirewall firewall show rule name="SMART TAKSASI Backend 3000" 2>&1');
if (strpos($rule, 'LocalPort:') !== false && strpos($rule, '3000') !== false) {
    echo "    OK: Firewall rule 'SMART TAKSASI Backend 3000' ditemukan\n";
} else {
    echo "    ⚠ Firewall rule tidak ditemukan\n";
    echo "    Buat rule: netsh advfirewall firewall add rule name=\"SMART TAKSASI Backend 3000\" dir=in action=allow protocol=TCP localport=3000\n";
}

// --- 5. Cek IP LAN ---
echo "\n[5] Cek IP LAN:\n";
$host = gethostnamel();
$ips = [];
if (function_exists('shell_exec')) {
    $out = shell_exec('ipconfig 2>nul');
    if ($out !== null) {
        preg_match_all('/IPv4 Address\\.\\.\\.\\.\\.\\.\\.\\.:\s+([\d\.]+)/', $out, $matches);
        $ips = $matches[1] ?? [];
    }
}
if (empty($ips)) {
    $ips = ['10.161.10.230']; // fallback
}
foreach ($ips as $ip) {
    echo "    $ip:3000\n";
}

echo "\n==========================================\n";
echo "Selesai: " . date('Y-m-d H:i:s') . "\n";
?>
