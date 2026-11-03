#!/usr/bin/env node
/**
 * Jalankan backend + tunnel supaya app bisa diakses dari jaringan mana pun.
 *
 * Kenapa script ini ada:
 *  - `cloudflared tunnel --url` biasa menghasilkan URL baru setiap restart,
 *    sehingga URL di HP selalu basi dan agen harus mengetik ulang.
 *  - Script ini menangkap URL yang muncul, menyimpannya ke file, dan
 *    mencetaknya dengan jelas supaya mudah disalin.
 *
 * Pemakaian:
 *   node scripts/online.js              # backend + tunnel
 *   node scripts/online.js --backend    # backend saja
 *   node scripts/online.js --tunnel     # tunnel saja (backend sudah jalan)
 */
'use strict';

const { spawn, exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudflared.exe');
const URL_FILE = path.join(ROOT, 'tunnel-url.txt');

/**
 * Papan pengumuman alamat server.
 *
 * Aplikasi membaca topik ini untuk menemukan backend tanpa pengguna
 * mengetik alamat apa pun. Harus sama dengan DiscoveryService.topic di app.
 * Anggap nama topik ini kunci rahasia bersama.
 */
const DISCOVERY_TOPIC = 'taksasi-srv-8k2m9x4q7v1n6p3w';
const DISCOVERY_URL = `https://ntfy.sh/${DISCOVERY_TOPIC}`;

/** Pesan di ntfy kedaluwarsa 12 jam; segarkan tiap 4 jam. */
const HEARTBEAT_MS = 4 * 60 * 60 * 1000;
const LOG_FILE = path.join(ROOT, 'tunnel.log');

const args = process.argv.slice(2);
const onlyBackend = args.includes('--backend');
const onlyTunnel = args.includes('--tunnel');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  teal: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const say = (msg) => console.log(msg);
const ok = (msg) => console.log(`${C.green}[OK]${C.reset} ${msg}`);
const warn = (msg) => console.log(`${C.yellow}[!]${C.reset} ${msg}`);
const fail = (msg) => console.log(`${C.red}[X]${C.reset} ${msg}`);

/** Cek backend hidup di localhost:3000. */
function checkHealth(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: 'localhost', port: 3000, path: '/health', timeout: timeoutMs },
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

/** Tunggu sampai backend menjawab, maksimal [tries] kali. */
async function waitForBackend(tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await checkHealth()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Umumkan alamat server ke papan pengumuman.
 *
 * Dipanggil setiap tunnel dapat URL baru, lalu diulang berkala supaya
 * pengumuman tidak kedaluwarsa selama backend menyala.
 */
function publishUrl(url) {
  return new Promise((resolve) => {
    let body;
    try {
      body = Buffer.from(url, 'utf8');
    } catch (_) {
      return resolve(false);
    }

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

/** Matikan proses yang memakai port 3000 (Windows). */
function killPort3000() {
  return new Promise((resolve) => {
    exec(
      'netstat -ano | findstr ":3000" | findstr "LISTENING"',
      (err, stdout) => {
        if (!stdout) return resolve();
        const pids = new Set();
        for (const line of stdout.trim().split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
        if (pids.size === 0) return resolve();
        let remaining = pids.size;
        for (const pid of pids) {
          // execFile: tidak lewat shell, argumen diteruskan langsung.
          execFile('taskkill', ['/F', '/PID', pid], () => {
            if (--remaining === 0) resolve();
          });
        }
      }
    );
  });
}

async function startBackend() {
  if (await checkHealth()) {
    ok('Backend sudah hidup di port 3000 — dipakai ulang.');
    return null;
  }

  await killPort3000();
  say(`${C.dim}[..] Menyalakan backend...${C.reset}`);

  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'app.js')], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  });
  child.unref();

  if (await waitForBackend()) {
    ok('Backend hidup di http://localhost:3000');
    return child;
  }

  fail('Backend tidak merespons. Jalankan manual: node src/app.js');
  return child;
}

/** Jalankan cloudflared dan tangkap URL publiknya. */
function startTunnel() {
  return new Promise((resolve) => {
    if (!fs.existsSync(CF)) {
      fail('cloudflared.exe tidak ditemukan di folder backend.');
      return resolve(null);
    }

    say(`${C.dim}[..] Membuka tunnel Cloudflare...${C.reset}`);

    const child = spawn(
      CF,
      ['tunnel', '--url', 'http://localhost:3000', '--no-autoupdate'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let captured = false;
    const handle = (buf) => {
      const text = buf.toString();
      fs.appendFileSync(LOG_FILE, text);
      if (captured) return;

      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!match) return;

      captured = true;
      const url = match[0];
      fs.writeFileSync(URL_FILE, url + '\n');

      say('');
      say(`${C.teal}${'='.repeat(62)}${C.reset}`);
      say(`${C.bold}  ALAMAT SERVER UNTUK APP${C.reset}`);
      say(`${C.teal}${'='.repeat(62)}${C.reset}`);
      say(`  ${C.bold}${C.green}${url}${C.reset}`);
      say('');
      say(`  Tempel di app → Pengaturan → Alamat Server`);
      say(`  ${C.dim}(URL ini juga tersimpan di tunnel-url.txt)${C.reset}`);
      say(`${C.teal}${'='.repeat(62)}${C.reset}`);
      say('');
      warn('URL berubah kalau jendela ini ditutup. Biarkan tetap terbuka.');
      say(`${C.dim}Tekan Ctrl+C untuk berhenti.${C.reset}`);
      say('');

      // Umumkan ke papan pengumuman supaya app bisa menemukannya sendiri.
      publishUrl(url).then((sent) => {
        if (sent) {
          say(`${C.dim}  Alamat diumumkan — app akan menemukannya otomatis.${C.reset}`);
        } else {
          warn('Gagal mengumumkan alamat. App perlu alamat dimasukkan manual.');
        }
      });

      // Segarkan berkala supaya pengumuman tidak kedaluwarsa (12 jam).
      setInterval(() => {
        publishUrl(url).then((sent) => {
          if (sent) say(`${C.dim}  Pengumuman alamat disegarkan.${C.reset}`);
        });
      }, HEARTBEAT_MS);

      resolve(url);
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);

    child.on('exit', (code) => {
      if (!captured) {
        fail(`cloudflared berhenti (kode ${code}). Lihat tunnel.log`);
        resolve(null);
      }
    });

    // Batas tunggu: tunnel biasanya siap dalam 5-20 detik.
    setTimeout(() => {
      if (!captured) {
        warn('URL belum muncul setelah 45 detik. Cek tunnel.log');
        resolve(null);
      }
    }, 45000);
  });
}

(async () => {
  say('');
  say(`${C.bold}SMART TAKSASI — Akses Internet${C.reset}`);
  say(`${C.dim}${'─'.repeat(62)}${C.reset}`);

  if (!onlyTunnel) {
    await startBackend();
  }

  if (onlyBackend) {
    say('');
    ok('Backend saja. Tunnel tidak dijalankan.');
    return;
  }

  if (!(await checkHealth())) {
    fail('Backend belum siap, tunnel tidak dijalankan.');
    process.exit(1);
  }

  await startTunnel();

  // Biarkan proses hidup selama tunnel berjalan.
  process.stdin.resume();
})().catch((e) => {
  fail(e.message);
  process.exit(1);
});
