<?php
/**
 * SMART TAKSASI — Cek Koneksi Server
 * Skrip sederhana ini memverifikasi apakah backend, firewall, 
 * dan jaringan user bisa terhubung.
 *
 * Format: JSON (mudah dibaca app/widget)
 * Atau: PHP check_server.php (tersedia)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$info = [
    'timestamp' => date('Y-m-d H:i:s'),
    'service' => 'SMART TAKSASI CHECK',
    'ipv4' => gethostbyname(gethostname()),
    'backend' => [
        'status' => 'unknown',
        'url' => 'http://localhost:3000/health',
        'checked_at' => date('Y-m-d H:i:s'),
    ],
    'remote' => [
        'status' => 'unknown',
        'url' => 'https://tgmvl-182-2-165-191.run.pinggy-free.link/health',
        'checked_at' => date('Y-m-d H:i:s'),
    ],
    'discovery' => [
        'topic' => 'taksasi-srv-8k2m9x4q7v1n6p3w',
        'url' => "https://ntfy.sh/{$info['discovery']['topic']}",
        'status' => 'unknown',
    ],
];

// Check backend
$ch = curl_init($info['backend']['url']);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$local = curl_exec($ch);
$localCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($localCode == 200) {
    $info['backend']['status'] = 'ok';
    $info['backend']['http_code'] = 200;
    $info['backend']['message'] = 'Backend aktif di port 3000';
} else {
    $info['backend']['status'] = 'error';
    $info['backend']['http_code'] = $localCode;
    $info['backend']['message'] = 'Backend tidak merespons (HTTP ' . $localCode . ')';
}

// Check remote tunnel
$ch = curl_init($info['remote']['url']);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$remote = curl_exec($ch);
$remoteCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($remoteCode == 200) {
    $info['remote']['status'] = 'ok';
    $info['remote']['http_code'] = 200;
    $info['remote']['message'] = 'Remote server hidup';
} else {
    $info['remote']['status'] = 'error';
    $info['remote']['http_code'] = $remoteCode;
    $info['remote']['message'] = 'Remote server tidak merespons (HTTP ' . $remoteCode . ')';
}

// Check discovery topic
$ch = curl_init($info['discovery']['url']);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, 'ping');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: text/plain']);
$disc = curl_exec($ch);
$discCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($discCode == 200) {
    $info['discovery']['status'] = 'ok';
    $info['discovery']['http_code'] = 200;
    $info['discovery']['message'] = 'Papan pengumuman aktif';
} else {
    $info['discovery']['status'] = 'error';
    $info['discovery']['http_code'] = $discCode;
    $info['discovery']['message'] = 'Papan pengumuman tidak bisa diakses (HTTP ' . $discCode . ')';
}

echo json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
?>
