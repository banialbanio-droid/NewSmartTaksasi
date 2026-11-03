const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  'C:/Users/USER/.gemini/antigravity-ide/PROJECT SMART TAKSASI V3.2/index.html',
  'utf-8'
);

function extractTable(name) {
  const marker = `const ${name} = JSON.parse('`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found`);
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("');", jsonStart);
  const raw = html.slice(jsonStart, jsonEnd);
  // Unescape: the HTML has \' and \\" sequences from JS string literal
  const unescaped = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return JSON.parse(unescaped);
}

const reguler = extractTable('CALC_REGULER_TABLE');
const awda = extractTable('CALC_AWDA_TABLE');

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'rate-reguler.json'),
  JSON.stringify(reguler, null, 0),
  'utf-8'
);
fs.writeFileSync(
  path.join(outDir, 'rate-awda.json'),
  JSON.stringify(awda, null, 0),
  'utf-8'
);

const rk = Object.keys(reguler).map(Number).sort((a, b) => a - b);
const ak = Object.keys(awda).map(Number).sort((a, b) => a - b);

console.log('REGULER rows:', rk.length, 'range', rk[0], '-', rk[rk.length - 1]);
console.log('AWDA    rows:', ak.length, 'range', ak[0], '-', ak[ak.length - 1]);
console.log('cols per row: Reguler', reguler[String(rk[0])].length, '| Awda', awda[String(ak[0])].length);
console.log('sample Reguler 15000000:', JSON.stringify(reguler['15000000']));
console.log('sample Awda    15000000:', JSON.stringify(awda['15000000']));
