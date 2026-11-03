const http = require('http');

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Require app.js (this will start the server via initDb)
  console.log('Loading app...');
  require('./src/app.js');
  
  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 1500));
  
  const tests = [
      { name: 'GET /health', fn: () => req('GET', '/health') },
      { name: 'POST /api/komite (create)', fn: () => req('POST', '/api/komite', { cs_id: 'SPV-PARUNG', contract_no: 'CTR-RECOV8', customer_name: 'Recovery Test 8' }) },
      { name: 'GET /api/komite (list)', fn: () => req('GET', '/api/komite') },
      { name: 'GET /api/komite/1 (detail)', fn: () => req('GET', '/api/komite/1') },
      { name: 'PUT /api/komite/1/status', fn: () => req('PUT', '/api/komite/1/status', { status: 'SELESAI', catatan: 'Status dari recovery' }) },
      { name: 'POST /api/komite/1/komentar', fn: () => req('POST', '/api/komite/1/komentar', { note: 'Komentar recovery' }) },
      { name: 'POST /api/entities/ActivityLog', fn: () => req('POST', '/api/entities/ActivityLog', { action: 'recovery_test', detail: JSON.stringify({ fid: 'SPV-PARUNG' }), created_date: '2025-01-01T00:00:00Z' }) },
      { name: 'GET /api/config', fn: () => req('GET', '/api/config') },
      { name: 'GET /api/master/status', fn: () => req('GET', '/api/master/status') },
      { name: 'GET /api/followup', fn: () => req('GET', '/api/followup') },
      { name: 'GET /api/users/cs-id', fn: () => req('GET', '/api/users/cs-id') },
    ];

    let pass = 0, fail = 0;
    for (const t of tests) {
      try {
        const res = await t.fn();
        const ok = res.status >= 200 && res.status < 300;
        console.log(`${ok ? '✅' : '❌'} ${t.name} → HTTP ${res.status}`);
        if (res.body) console.log(`   Body: ${res.body.substring(0, 120)}${res.body.length > 120 ? '...' : ''}`);
        if (ok) pass++; else fail++;
      } catch (e) {
        console.log(`❌ ${t.name} → ERROR: ${e.message}`);
        fail++;
      }
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    server.close(() => process.exit(0));
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });