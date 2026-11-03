/**
 * Smoke test semua endpoint bisnis.
 * Jalankan: node scripts/test-endpoints.js
 */
const BASE = 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

function show(label, result, pick) {
  const status = result.status;
  const ok = status >= 200 && status < 300 ? 'OK ' : 'ERR';
  let detail = '';
  if (result.body && typeof result.body === 'object') {
    if (pick) detail = pick(result.body);
    else detail = JSON.stringify(result.body).slice(0, 220);
  } else {
    detail = String(result.body).slice(0, 160);
  }
  console.log(`[${ok} ${status}] ${label}\n        ${detail}`);
}

(async () => {
  console.log('=== SMOKE TEST ENDPOINT BISNIS ===\n');

  // 1. LOGIN
  const login = await req('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csId: 'SPV-PARUNG', pin: '123456' })
  });
  show('POST /auth/login (supervisor)', login, (b) =>
    b.success ? `role=${b.user.role} tokenLen=${(b.token || '').length}` : JSON.stringify(b)
  );

  if (!login.body.success) {
    console.log('\nLogin gagal, test dihentikan.');
    process.exit(1);
  }
  const token = login.body.token;
  const H = { Authorization: `Bearer ${token}` };

  console.log('');

  // 2. OTR
  const brands = await req('/api/v1/otr/brands/list', { headers: H });
  show('GET /otr/brands/list', brands, (b) => `${b.data ? b.data.length : 0} brand`);

  const otr = await req('/api/v1/otr/search?brand=HONDA&tahun=2024&limit=2', { headers: H });
  show('GET /otr/search?brand=HONDA&tahun=2024', otr, (b) =>
    b.success ? `total=${b.pagination.total} returned=${b.pagination.returned} first=${b.data[0] ? b.data[0].model + '/' + b.data[0].harga_pasar : '-'}` : JSON.stringify(b)
  );

  console.log('');

  // 3. CLOP
  const clopStats = await req('/api/v1/clop/stats', { headers: H });
  show('GET /clop/stats', clopStats, (b) =>
    b.success ? `total=${b.data.total} trends=${b.data.breakdown.length}` : JSON.stringify(b)
  );

  const clopCheck = await req('/api/v1/clop/check/104000478424', { headers: H });
  show('GET /clop/check/104000478424', clopCheck, (b) =>
    b.success ? `found=${b.found} ${b.data ? 'cycle=' + b.data.cycleAwal + ' trend=' + b.data.trendCycle + ' eligible=' + b.data.eligible : b.message}` : JSON.stringify(b)
  );

  const clopMiss = await req('/api/v1/clop/check/999999999999', { headers: H });
  show('GET /clop/check/999999999999 (tidak ada)', clopMiss, (b) => `found=${b.found}`);

  console.log('');

  // 4. BOOKING QUALITY
  const bqStats = await req('/api/v1/booking-quality/stats/summary', { headers: H });
  show('GET /booking-quality/stats/summary', bqStats, (b) =>
    b.success ? `kontrak=${b.data.totalKontrak} tunggakan=${b.data.totalTunggakan} dpd=${b.data.totalDpd}` : JSON.stringify(b)
  );

  const bqList = await req('/api/v1/booking-quality?limit=3', { headers: H });
  show('GET /booking-quality?limit=3', bqList, (b) =>
    b.success ? `total=${b.pagination.total} returned=${b.pagination.returned}` : JSON.stringify(b)
  );

  let bqContract = null;
  if (bqList.body.success && bqList.body.data.length > 0) {
    bqContract = bqList.body.data[0].contractNo;
    const bqDetail = await req(`/api/v1/booking-quality/${bqContract}`, { headers: H });
    show(`GET /booking-quality/${bqContract}`, bqDetail, (b) =>
      b.success ? `${b.data.customerName} status=${b.data.statusBq} dpd=${b.data.overdue}` : JSON.stringify(b)
    );

    const bqUpdate = await req(`/api/v1/booking-quality/${bqContract}`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ janjiBayar: '2026-11-05', reason: 'Smoke test' })
    });
    show(`PUT /booking-quality/${bqContract}`, bqUpdate, (b) =>
      b.success ? `janjiBayar=${b.data.janjiBayar} reason=${b.data.reason}` : JSON.stringify(b)
    );
  }

  console.log('');

  // 5. REPEAT ORDER
  const roStats = await req('/api/v1/repeat-order/stats/summary', { headers: H });
  show('GET /repeat-order/stats/summary', roStats, (b) =>
    b.success ? `total=${b.data.total} statuses=${b.data.breakdown.length}` : JSON.stringify(b)
  );

  const roList = await req('/api/v1/repeat-order?limit=3', { headers: H });
  show('GET /repeat-order?limit=3', roList, (b) =>
    b.success ? `total=${b.pagination.total} returned=${b.pagination.returned}` : JSON.stringify(b)
  );

  if (roList.body.success && roList.body.data.length > 0) {
    const roContract = roList.body.data[0].contractNo;
    const roDetail = await req(`/api/v1/repeat-order/${roContract}`, { headers: H });
    show(`GET /repeat-order/${roContract}`, roDetail, (b) =>
      b.success ? `${b.data.customerName} status=${b.data.statusFollowup} sisa=${b.data.sisaAngsuran}` : JSON.stringify(b)
    );

    const roUpdate = await req(`/api/v1/repeat-order/${roContract}`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusFollowup: 'DIHUBUNGI', catatan: 'Smoke test follow-up' })
    });
    show(`PUT /repeat-order/${roContract}`, roUpdate, (b) =>
      b.success ? `status=${b.data.statusFollowup} catatan=${b.data.catatan}` : JSON.stringify(b)
    );
  }

  console.log('\n=== SELESAI ===');
})();
