// Run with the server up:  npm run dev (or npm start), then: npm test
const B = process.env.API || 'http://127.0.0.1:4000';
let fail = 0; const ok = (c, m) => {console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++};
const j = async (p, o) => {const r = await fetch(B + p, o); return {s: r.status, b: await r.json().catch(() => ({}))}};
const login = (password, extra = {}) => j('/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'ada', email: 'ada@x.io', password, ...extra})});
let r = await login('wrong'); ok(r.s === 401, 'wrong password rejected');
r = await login('Vault1027', {email: 'nope'}); ok(r.s === 400 && r.b.errors.email, 'invalid email rejected');
r = await login('Vault1027', {username: ''}); ok(r.s === 400 && r.b.errors.username, 'missing username rejected');
r = await login('Vault1027'); ok(r.s === 200 && r.b.token, 'correct password accepted (after failures)');
const H = {authorization: 'Bearer ' + r.b.token};
const up = async (name, text) => {
  const fd = new FormData(); fd.append('file', new Blob([text]), name);
  const u = await j('/api/upload', {method: 'POST', headers: H, body: fd}); if (u.s !== 202) return u;
  for (let i = 0; i < 100; i++) {const p = await j('/api/jobs/' + u.b.jobId, {headers: H}); if (p.b.status !== 'running') return p; await new Promise(r => setTimeout(r, 50))}
};
const get = id => j('/api/analyses/' + id, {headers: H});
const noAuth = await j('/api/upload', {method: 'POST'}); ok(noAuth.s === 401, 'upload requires login');
let d1 = 'id,city,sales,qty,when\n' + Array.from({length: 120}, (_, i) => `${i},${['A', 'B', 'C'][i % 3]},${i % 7 === 0 ? '' : i * 3.5},${i % 10},2026-0${1 + i % 6}-1${i % 9}`).join('\n') + '\n5,B,17.5,5,2026-06-15\n5,B,17.5,5,2026-06-15\n';
let p = await up('a.csv', d1); ok(p.b.status === 'done', 'valid CSV #1 processed');
let a = (await get(p.b.analysisId)).b;
ok(a.summary.rows === 122 && a.summary.columns === 5, `row/col counts exact (${a.summary.rows}x${a.summary.columns})`);
const missExpected = d1.split('\n').slice(1).filter(l => l.split(',')[2] === '').length;
ok(a.columns.find(c => c.name === 'sales').missing === missExpected, `missing count exact (${missExpected})`);
ok(a.summary.duplicateRows >= 1, 'duplicates detected');
ok(a.columns.find(c => c.name === 'qty').type === 'numeric' && a.columns.find(c => c.name === 'city').type === 'categorical' && a.columns.find(c => c.name === 'when').type === 'date', 'types inferred');
const qty = Array.from({length: 120}, (_, i) => i % 10).concat([5, 5]); const mean = qty.reduce((x, y) => x + y) / qty.length;
ok(Math.abs(a.columns.find(c => c.name === 'qty').stats.mean - mean) < 1e-3, 'mean computed from real data');
let d2 = 'name;score;grade\nx;1;A\ny;2;B\nz;3;A\nw;10;C\n'; p = await up('b.csv', d2); const a2 = (await get(p.b.analysisId)).b;
ok(a2.summary.rows === 4 && a2.summary.columns === 3 && a2.delimiter === ';', 'valid CSV #2 (different shape, ; delimiter) processed');
ok(a2.id !== a.id && a2.filename === 'b.csv', 'second dataset yields separate results');
p = await up('bad.csv', 'a,b,c\n1,2,3\n"unterminated,4,5\n6\n'); ok(p.b.status === 'error', 'malformed CSV rejected: ' + p.b.error);
p = await up('bad2.csv', 'a,b,c\n1\n2,3\n4\n5,6,7,8\n9\n'); ok(p.b.status === 'error', 'inconsistent rows rejected');
p = await up('x.txt', 'a,b\n1,2'); ok(p.s === 415, 'non-csv extension rejected');
p = await up('empty.csv', ''); ok(p.s === 422, 'empty file rejected');
p = await up('bin.csv', Buffer.from([0x89, 0x50, 0, 1, 2, 0])); ok(p.b.status === 'error', 'binary content rejected server-side');
r = await get('00000000-0000-0000-0000-000000000000'); ok(r.s === 404, 'unknown analysis => 404');
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exit(fail ? 1 : 0);
