#!/usr/bin/env node
/**
 * Jalankan backend + akses internet, dengan pengawasan.
 *
 * Kenapa script ini ada:
 *
 *  1. `cloudflared tunnel --url` bisa **macet** — prosesnya masih hidup,
 *     tapi tunnel-nya sudah dicabut di sisi Cloudflare ("Tunnel not found")
 *     dan dia mengulang selamanya tanpa pernah pulih. URL yang dipegang
 *     jadi mati, dan app gagal tersambung tanpa penjelasan.
 *     Script ini memantau dan membuka tunnel baru kalau itu terjadi.
 *
 *  2. Alamat publik hanya diumumkan ke papan pengumuman **setelah
 *     dipastikan benar-benar hidup**. Sebelumnya alamat mati ikut
 *     diumumkan, sehingga app menemukan alamat yang tidak bisa dihubungi.
 *
 * Pemakaian:
 *   node scripts/online.js              # backend + tunnel + pengawasan
 *   node scripts/online.js --backend    # backend saja
 *   node scripts/online.js --tailscale  # backend + tampilkan alamat Tailscale
 *   node scripts/online.js --tunnel     # tunnel saja (backend sudah jalan)
 */
'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudflared.exe');
const URL_FILE = path.join(ROOT, 'tunnel-url.txt');
const LOG_FILE = path.join(ROOT, 'tunnel.log');
const TS_BIN = 'C:\\Program Files\\Tailscale\\tailscale.exe';

/** Papan pengumuman alamat. Harus sama dengan DiscoveryService.topic di app. */
const DISCOVERY_TOPIC = 'taksasi-srv-8k2m9x4q7v1n6p3w';
const DISCOVERY_URL = `https://ntfy.sh/${DISCOVERY_TOPIC}`;
const HEARTBEAT_MS = 4 * 60 * 60 * 1000; // pesan ntfy kedaluwarsa 12 jam

/** Batas menunggu URL muncul dari cloudflared. */
const READY_TIMEOUT_MS = 90 * 1000;

/** Jarak pemeriksaan kesehatan alamat publik. */
const WATCH_MS = 60 * 1000;

const args = process.argv.slice(2);
const onlyBackend = args.includes('--backend');
const onlyTunnel = args.includes('--tunnel');
const useTailscale = args.includes('--tailscale');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  teal: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const say = (m) => console.log(m);
const ok = (m) => console.log(`${C.green}[OK]${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}[!]${C.reset} ${m}`);
const fail = (m) => console.log(`${C.red}[X]${C.reset} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ambil body JSON dari sebuah URL; null kalau gagal. */
function fetchJson(url, timeoutMs) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (_) {
            resolve(null);
          }
        });
      });
    } catch (_) {
      return resolve(null);
    }
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Cek backend hidup. [host] boleh 'localhost' atau IP Tailscale. */
function checkHealth(host = 'localhost', timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port: 3000, path: '/health', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).status === 'ok');
          } catch (_) {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Cek alamat publik https hidup. */
async function checkPublicHealth(base, timeoutMs = 12000) {
  const body = await fetchJson(`${base}/health`, timeoutMs);
  return body !== null && body.status === 'ok';
}

async function waitForBackend(tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await checkHealth()) return true;
    await sleep(1000);
  }
  return false;
}

/** Umumkan alamat ke papan pengumuman. */
function publishUrl(url) {
  return new Promise((resolve) => {
    const body = Buffer.from(url, 'utf8');
    const req = https.request(
      DISCOVERY_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': body.length,
        },
        timeout: 12000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

/**
 * Matikan proses yang memakai port 3000.
 *
 * Memakai execFile dengan argumen array (bukan exec dengan string shell),
 * jadi tidak ada teks yang ditafsirkan oleh shell.
 */
function killPort3000() {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], (err, stdout) => {
      if (err || !stdout) return resolve();

      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(':3000')) continue;
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }

      if (pids.size === 0) return resolve();

      let remaining = pids.size;
      for (const pid of pids) {
        execFile('taskkill', ['/F', '/PID', pid], () => {
          if (--remaining === 0) resolve();
        });
      }
    });
  });
}

async function startBackend() {
  if (await checkHealth()) {
    ok('Backend sudah hidup di port 3000 — dipakai ulang.');
    return;
  }
  await killPort3000();
  say(`${C.dim}[..] Menyalakan backend...${C.reset}`);
  spawn(process.execPath, [path.join(ROOT, 'src', 'app.js')], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  }).unref();

  if (await waitForBackend()) {
    ok('Backend hidup di http://localhost:3000');
  } else {
    fail('Backend tidak merespons. Jalankan manual: node src/app.js');
  }
}

/** Jalankan satu instance cloudflared, tangkap URL-nya. */
function spawnTunnel() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CF,
      // 127.0.0.1, bukan localhost: di Windows `localhost` bisa resolve ke
      // ::1 lebih dulu, dan sebagian setup Node/Express hanya mendengar
      // IPv4 — tunnel lalu dapat 502 walau backend sehat.
      ['tunnel', '--url', 'http://127.0.0.1:3000', '--no-autoupdate'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let captured = false;
    let rateLimited = false;
    const timer = setTimeout(() => {
      if (captured) return;
      try {
        child.kill();
      } catch (_) {}
      reject(new Error('URL tidak muncul dalam 90 detik'));
    }, READY_TIMEOUT_MS);

    const handle = (buf) => {
      const text = buf.toString();
      try {
        fs.appendFileSync(LOG_FILE, text);
      } catch (_) {}

      if (captured) return;

      // Cloudflare membatasi pembuatan quick tunnel tanpa akun (HTTP 429).
      // Kalau dibiarkan, cloudflared mengulang selamanya dan kita menunggu
      // 90 detik untuk sesuatu yang tidak akan datang. Deteksi dan berhenti
      // cepat supaya watchdog bisa menunggu lebih lama sebelum mencoba lagi.
      if (
        !rateLimited &&
        (/status 429/.test(text) || /provisioning failed/.test(text))
      ) {
        rateLimited = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch (_) {}
        const err = new Error(
          'Cloudflare menolak membuat tunnel baru (rate limit 429). ' +
            'Tunggu beberapa menit, atau pakai akun Cloudflare (named tunnel).'
        );
        err.rateLimited = true;
        reject(err);
        return;
      }

      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!match) return;

      captured = true;
      clearTimeout(timer);
      resolve({ url: match[0], child });
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);

    child.on('exit', (code) => {
      if (captured) return;
      clearTimeout(timer);
      reject(new Error(`cloudflared berhenti (kode ${code})`));
    });
  });
}

/**
 * Jalankan localtunnel sebagai cadangan saat Cloudflare menolak (429).
 *
 * Cloudflare membatasi pembuatan quick tunnel tanpa akun per-IP. Kalau
 * batas itu tercapai, tidak ada cara mempercepatnya selain menunggu.
 * localtunnel memberi alamat publik lain tanpa akun, jadi tim tetap bisa
 * kerja sementara Cloudflare pulih.
 */
function spawnLocaltunnel() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['--yes', 'localtunnel', '--port', '3000'],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      }
    );

    let captured = false;
    const timer = setTimeout(() => {
      if (captured) return;
      try {
        child.kill();
      } catch (_) {}
      reject(new Error('localtunnel tidak memberi URL dalam 90 detik'));
    }, READY_TIMEOUT_MS);

    const handle = (buf) => {
      if (captured) return;
      const text = buf.toString();
      try {
        fs.appendFileSync(LOG_FILE, text);
      } catch (_) {}
      const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
      if (!match) return;
      captured = true;
      clearTimeout(timer);
      resolve({ url: match[0], child });
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);

    child.on('exit', (code) => {
      if (captured) return;
      clearTimeout(timer);
      reject(new Error(`localtunnel berhenti (kode ${code})`));
    });
  });
}

/**
 * Jalankan Pinggy lewat SSH sebagai cadangan terakhir.
 *
 * Dipakai hanya kalau Cloudflare menolak (429) dan localtunnel gagal.
 * Pinggy membuka reverse SSH tunnel tanpa akun; alamatnya berlaku 60 menit
 * lalu harus dibuka ulang. Cukup untuk kerja hari ini, bukan untuk permanen.
 */
function spawnPinggy() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [
        '-p', '443',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ServerAliveInterval=30',
        '-R0:127.0.0.1:3000',
        'a.pinggy.io',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );

    let captured = false;
    const timer = setTimeout(() => {
      if (captured) return;
      try {
        child.kill();
      } catch (_) {}
      reject(new Error('Pinggy tidak memberi URL dalam 60 detik'));
    }, 60000);

    const handle = (buf) => {
      if (captured) return;
      const text = buf.toString();
      try {
        fs.appendFileSync(LOG_FILE, text);
      } catch (_) {}
      const match = text.match(
        /https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link/
      );
      if (!match) return;
      captured = true;
      clearTimeout(timer);
      resolve({ url: match[0], child });
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);

    child.on('exit', (code) => {
      if (captured) return;
      clearTimeout(timer);
      reject(new Error(`Pinggy berhenti (kode ${code})`));
    });
  });
}

/**
 * Jalankan tunnel sampai alamatnya benar-benar hidup, lalu pantau terus.
 *
 * Kalau alamat mati — persis masalah yang membuat app tidak bisa
 * tersambung — tunnel lama dimatikan dan dibuka tunnel baru.
 */
async function runTunnelWithWatchdog() {
  if (!fs.existsSync(CF)) {
    fail('cloudflared.exe tidak ditemukan di folder backend.');
    return;
  }

  let attempt = 0;
  // Jeda antar percobaan naik bertahap. Versi lama mencoba ulang tiap 10
  // detik; saat Cloudflare membatasi (429) itu justru memperpanjang
  // pembatasan karena setiap percobaan dihitung sebagai permintaan baru.
  let backoffMs = 30000;

  for (;;) {
    attempt++;
    say('');
    say(`${C.dim}[..] Membuka tunnel Cloudflare (percobaan ${attempt})...${C.reset}`);

    let tunnel;
    try {
      tunnel = await spawnTunnel();
    } catch (e) {
      if (e.rateLimited) {
        const mins = Math.round(backoffMs / 60000);
        warn('Cloudflare membatasi pembuatan tunnel baru (429).');
        warn('Beralih ke tunnel cadangan...');

        // Coba cadangan dulu supaya tim tetap bisa kerja sekarang, lalu
        // tunggu sebelum Cloudflare dicoba lagi.
        let fallback = null;
        try {
          fallback = await spawnPinggy();
          ok('Cadangan Pinggy aktif.');
        } catch (e2) {
          warn(`Pinggy gagal: ${e2.message}`);
          try {
            fallback = await spawnLocaltunnel();
            ok('Cadangan localtunnel aktif.');
          } catch (e3) {
            warn(`localtunnel gagal: ${e3.message}`);
          }
        }

        if (fallback) {
          tunnel = fallback;
        } else {
          warn(`Menunggu ${mins} menit sebelum mencoba Cloudflare lagi...`);
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 15 * 60 * 1000);
          continue;
        }
      } else {
        warn(`Tunnel gagal dibuka: ${e.message}`);
        warn('Coba lagi dalam 30 detik...');
        await sleep(30000);
        continue;
      }
    }

    const { url, child } = tunnel;
    say(`${C.dim}[..] Menunggu ${url} siap...${C.reset}`);

    // Alamat baru diumumkan hanya setelah terbukti hidup. Mengumumkan
    // terlalu cepat membuat app menemukan alamat yang belum bisa dipakai.
    //
    // DNS Cloudflare untuk hostname quick tunnel baru kadang butuh ~30-60
    // detik sebelum record A-nya terbit. Sebelum itu request gagal seketika
    // (bukan timeout), jadi jendela tunggu dibuat panjang: 30 x 3 detik.
    let alive = false;
    for (let i = 0; i < 30; i++) {
      if (await checkPublicHealth(url, 8000)) {
        alive = true;
        break;
      }
      await sleep(3000);
    }

    if (!alive) {
      warn('Alamat belum hidup setelah ditunggu. Restart tunnel...');
      try {
        child.kill();
      } catch (_) {}
      await sleep(5000);
      continue;
    }

    try {
      fs.writeFileSync(URL_FILE, url + '\n');
    } catch (_) {}

    say('');
    say(`${C.teal}${'='.repeat(64)}${C.reset}`);
    say(`${C.bold}  SERVER SIAP — BISA DIPAKAI DARI JARINGAN MANA PUN${C.reset}`);
    say(`${C.teal}${'='.repeat(64)}${C.reset}`);
    say(`  ${C.green}${url}${C.reset}`);
    say('');
    say('  App akan menemukannya sendiri. Tidak perlu mengetik apa pun.');
    say(`${C.teal}${'='.repeat(64)}${C.reset}`);
    say('');

    if (await publishUrl(url)) {
      ok('Alamat diumumkan — app akan menemukannya otomatis.');
    } else {
      warn('Gagal mengumumkan. Masukkan alamat di atas secara manual.');
    }

    // Segarkan pengumuman berkala (pesan ntfy kedaluwarsa 12 jam).
    const beat = setInterval(() => {
      publishUrl(url).catch(() => {});
    }, HEARTBEAT_MS);

    // Pantau terus: alamat mati = buka tunnel baru.
    say(`${C.dim}Memantau koneksi tiap 60 detik...${C.reset}`);
    for (;;) {
      await sleep(WATCH_MS);
      if (!(await checkPublicHealth(url, 10000))) {
        warn('Alamat publik tidak merespons lagi — membuka tunnel baru...');
        break;
      }
    }

    clearInterval(beat);
    try {
      child.kill();
    } catch (_) {}
    await sleep(3000);
  }
}

/** Tampilkan alamat Tailscale (permanen, tidak perlu tunnel). */
async function showTailscale() {
  if (!fs.existsSync(TS_BIN)) {
    warn('Tailscale tidak terpasang di PC ini.');
    return null;
  }

  const ip = await new Promise((resolve) => {
    execFile(TS_BIN, ['ip', '-4'], (err, stdout) => {
      const first = (stdout || '').split('\n')[0].trim();
      resolve(err || !first ? null : first);
    });
  });

  if (!ip) {
    warn('Tailscale belum login. Buka app Tailscale di PC.');
    return null;
  }

  const alive = await checkHealth(ip);

  say('');
  say(`${C.teal}${'='.repeat(64)}${C.reset}`);
  say(`${C.bold}  ALAMAT TAILSCALE — PERMANEN, TIDAK PERNAH BERUBAH${C.reset}`);
  say(`${C.teal}${'='.repeat(64)}${C.reset}`);
  say(`  ${C.green}http://${ip}:3000${C.reset}`);
  say('');
  say(`  ${alive ? 'Backend terjangkau di alamat ini.' : 'Backend belum terjangkau.'}`);
  say('  Syarat: HP juga terpasang app Tailscale, login akun yang sama.');
  say('  Tanpa tunnel, tanpa alamat berubah, tanpa menunggu.');
  say(`${C.teal}${'='.repeat(64)}${C.reset}`);
  say('');

  return ip;
}

(async () => {
  say('');
  say(`${C.bold}SMART TAKSASI — Akses Internet${C.reset}`);
  say(`${C.dim}${'─'.repeat(64)}${C.reset}`);

  if (!onlyTunnel) await startBackend();

  if (onlyBackend) {
    ok('Backend saja. Tunnel tidak dijalankan.');
    return;
  }

  if (!(await checkHealth())) {
    fail('Backend belum siap, tunnel tidak dijalankan.');
    process.exitCode = 1;
  }

  await showTailscale();

  if (useTailscale) {
    say(`${C.dim}Backend tetap menyala. Tekan Ctrl+C untuk berhenti.${C.reset}`);
    process.stdin.resume();
    return;
  }

  await runTunnelWithWatchdog();
})().catch((e) => {
  // Catat ke file juga: process.exit() memotong buffer stdout di Windows,
  // jadi pesan error bisa hilang dari konsol dan log tampak kosong.
  try {
    fs.appendFileSync(
      LOG_FILE,
      `\n[FATAL] ${new Date().toISOString()} ${e && e.stack ? e.stack : e}\n`
    );
  } catch (_) {}
  fail(e && e.message ? e.message : String(e));
  process.exitCode = 1;
});
