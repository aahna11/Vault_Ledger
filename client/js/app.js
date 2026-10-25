import {esc, fmt, empty, bars, histogram, scatter, line, heatmap, gauge} from './charts.js';

/* ---------- state (token in sessionStorage; analysis id in localStorage; results live on the server) ---------- */
const store = {
  get: (k, s = false) => {try {return (s ? sessionStorage : localStorage).getItem(k)} catch {return null}},
  set: (k, v, s = false) => {try {v == null ? (s ? sessionStorage : localStorage).removeItem(k) : (s ? sessionStorage : localStorage).setItem(k, v)} catch {}},
};
const S = {token: store.get('vl_token', true) || '', user: JSON.parse(store.get('vl_user', true) || 'null'), aid: store.get('vl_aid') || '', analysis: null, lost: ''};
const app = document.getElementById('app');
let cleanup = null, maxMb = 10;

async function api(path, opts = {}) {
  let r; try {r = await fetch(path, {...opts, headers: {...(opts.headers || {}), ...(S.token ? {Authorization: 'Bearer ' + S.token} : {})}})} catch {throw Object.assign(new Error('Cannot reach the server. Is it running (npm start)?'), {status: 0})}
  const b = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) {logout(false); location.hash = '#/login'}
  if (!r.ok) throw Object.assign(new Error(b.error || `Request failed (${r.status})`), {status: r.status, body: b});
  return b;
}
function logout(go = true) {S.token = ''; S.user = null; store.set('vl_token', null, true); store.set('vl_user', null, true); if (go) location.hash = '#/'}
function setAnalysis(a) {S.analysis = a; S.aid = a.id; S.lost = ''; store.set('vl_aid', a.id)}
async function ensureAnalysis() {
  if (S.analysis && S.analysis.id === S.aid) return S.analysis;
  try {const a = await api('/api/analyses/' + S.aid); S.analysis = a; return a}
  catch (e) {if (e.status === 404) {S.aid = ''; S.analysis = null; store.set('vl_aid', null); S.lost = e.message} throw e}
}
const go = h => {location.hash = h};

/* ---------- shared pieces ---------- */
const logo = `<a class="logo" href="#/" aria-label="VaultLedger home"><svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="currentColor"/><path d="M9 11l7 11 7-11" fill="none" stroke="var(--bg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
const topnav = (right = '') => `<header class="topnav">${logo}<nav aria-label="Primary"><a href="#/">Home</a><a href="#/about">About</a><a href="#/upload">Upload</a>${S.analysis || S.aid ? '<a href="#/dashboard">Dashboard</a>' : ''}</nav><div class="navr">${right}</div></header>`;
const toast = (el, msg, kind = 'err') => {el.className = 'msg ' + kind; el.textContent = msg; el.hidden = !msg};

/* ---------- 1. Landing ---------- */
async function landing() {
  app.innerHTML = `<main class="page landing">
  <section class="hero dark" id="top">
    <div class="scene-host" id="scene"><div class="fallback" hidden><div class="orb"></div><div class="orb o2"></div></div></div>
    <div class="hero-ui">${topnav(`<a class="btn ghost sm" href="#/login">Log in</a><a class="btn solid sm" href="#/login">Get started</a>`)}
      <div class="hero-copy"><p class="eyebrow">Double-entry ledger · Dataset studio</p>
        <h1>VaultLedger</h1>
        <p class="lead">Move money between accounts with a ledger that always balances — then drop in any CSV and see its quality, statistics and patterns in seconds.</p>
        <div class="row"><a class="btn solid" id="enter" href="#/login">Enter VaultLedger →</a><a class="btn ghost" href="#about">Learn more ↓</a></div>
        <p class="hint" id="hint" tabindex="0" role="button" aria-label="Double-click the chrome form, or press Enter here, to continue">Double-click the chrome form to enter</p></div></div>
  </section>
  <section class="light sect" id="about"><div class="wrap grid2"><div><p class="eyebrow dk">About the project</p><h2>A ledger that can’t lose a rupee.</h2></div>
    <div><p>VaultLedger is a double-entry ledger for tracking money moving between internal accounts — Operating, Payroll, Tax Vault, Savings and more — denominated in INR. Every transaction posts a debit and a matching credit, and a ledger CSV is validated before anything is imported.</p>
    <p>This edition adds a <b>dataset studio</b>: upload any CSV and the backend profiles it — types, missing values, duplicates, statistics, correlations — and turns it into a dashboard.</p><a class="btn solid sm" href="#/login">Try it →</a></div></div></section>
  <section class="light sect alt"><div class="wrap"><p class="eyebrow dk">Real-world applications</p><h2>Where this fits</h2><div class="cards">
    ${[['Treasury & reserves', 'Track payroll, rent, tax and vendor pools as separate accounts and see exactly where cash moved.'], ['Statement reconciliation', 'Upload bank statements or exports and check them for gaps, duplicates and outliers before anyone relies on them.'], ['Audit-ready records', 'Idempotent imports and a full transaction trail mean every balance can be explained line by line.'], ['Quick data profiling', 'Any analyst can drop in a CSV and get a trustworthy first look — no notebook needed.']].map(([h, p]) => `<article class="card light"><h3>${h}</h3><p>${p}</p></article>`).join('')}</div></div></section>
  <section class="dark sect"><div class="wrap"><p class="eyebrow">Interesting facts</p><h2>Built to be correct</h2><div class="cards facts">
    ${[['2', 'ledger entries per transaction — one debit, one credit — so the books always balance.'], ['paise', 'Money is stored as whole integers, never floats, to avoid rounding drift.'], ['SHA-256', 'Imports are fingerprinted so re-uploading the same file never double-posts.'], ['0', 'overdrafts allowed: imports are replayed in date order and rejected if an account would go negative.']].map(([n, t]) => `<article class="card dark"><div class="big">${n}</div><p>${t}</p></article>`).join('')}</div>
    <div class="cta"><h2>Ready?</h2><a class="btn solid" href="#/login">Continue to login →</a></div></div></section>
  <footer class="foot dark"><div class="wrap">VaultLedger · demo project · password check is a demonstration, not production authentication</div></footer></main>`;
  const goNext = () => go('#/login');
  const hint = document.getElementById('hint'); hint.onkeydown = e => {if (e.key === 'Enter' || e.key === ' ') goNext()}; hint.ondblclick = goNext;
  document.querySelector('a[href="#about"]').onclick = e => {e.preventDefault(); document.getElementById('about').scrollIntoView({behavior: 'smooth'})};
  const host = document.getElementById('scene'); let disposed = false, stop = null;
  import('./scene.js').then(m => m.mountScene(host, goNext)).then(d => {if (disposed) {d?.(); return} if (!d) host.querySelector('.fallback').hidden = false; else stop = d}).catch(() => host.querySelector('.fallback').hidden = false);
  host.querySelector('.fallback').ondblclick = goNext;
  cleanup = () => {disposed = true; stop?.()};
}
function about() {location.hash = '#/'; setTimeout(() => document.getElementById('about')?.scrollIntoView(), 50)}

/* ---------- 2. Login ---------- */
function login() {
  app.innerHTML = `<main class="page split">
  <section class="split-l dark"><div class="in">${logo}<div><p class="eyebrow">Step 1 of 3</p><h1 class="h-xl">Welcome<br>back.</h1><p class="lead">Tell us who’s working, then continue to upload your dataset.</p></div></div></section>
  <section class="split-r light"><form id="f" class="card form" novalidate aria-labelledby="ft"><h2 id="ft">Sign in</h2>
    <label>Username<input name="username" autocomplete="username" required minlength="2" placeholder="e.g. ada"><small class="fe" data-for="username"></small></label>
    <label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"><small class="fe" data-for="email"></small></label>
    <label>Password<span class="pw"><input name="password" type="password" autocomplete="current-password" required placeholder="Password"><button type="button" class="eye" aria-label="Show password">Show</button></span><small class="fe" data-for="password"></small></label>
    <div class="demo" role="note"><b>Demo password:</b> <code>Vault1027</code> <button type="button" class="link" id="fill">use it</button><br><span>Demonstration only — not production authentication.</span></div>
    <div class="msg" id="msg" role="alert" hidden></div>
    <button class="btn solid wide" id="go">Verify &amp; continue</button>
    <div id="ok" hidden><div class="msg ok" role="status">✓ Verified. Welcome, <b id="who"></b>.</div><a class="btn solid wide" href="#/upload">Continue to dataset upload →</a></div>
  </form></section></main>`;
  const f = document.getElementById('f'), msg = document.getElementById('msg'), fe = n => f.querySelector(`[data-for="${n}"]`);
  f.querySelector('.eye').onclick = e => {const i = f.password; i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'};
  document.getElementById('fill').onclick = () => {f.password.value = 'Vault1027'; f.password.focus()};
  if (S.token && S.user) {f.username.value = S.user.username; f.email.value = S.user.email}
  f.onsubmit = async e => {
    e.preventDefault(); toast(msg, ''); f.querySelectorAll('.fe').forEach(x => x.textContent = ''); f.classList.remove('shake');
    const v = {username: f.username.value.trim(), email: f.email.value.trim(), password: f.password.value}, errs = {};
    if (v.username.length < 2) errs.username = 'Enter a username (at least 2 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errs.email = v.email ? 'Enter a valid email address.' : 'Email is required.';
    if (!v.password) errs.password = 'Password is required.';
    const show = er => {for (const k in er) fe(k).textContent = er[k]; f.classList.add('shake'); f.querySelector(`[name="${Object.keys(er)[0]}"]`)?.focus()};
    if (Object.keys(errs).length) return show(errs);
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(v)});
      S.token = r.token; S.user = r.user; store.set('vl_token', r.token, true); store.set('vl_user', JSON.stringify(r.user), true);
      document.getElementById('who').textContent = r.user.username; document.getElementById('ok').hidden = false; btn.hidden = true; f.querySelectorAll('input').forEach(i => i.readOnly = true);
    } catch (er) {toast(msg, er.message); show(er.body?.errors || {password: er.status === 0 ? '' : 'Incorrect.'}); f.password.select()}
    finally {btn.disabled = false; btn.textContent = 'Verify & continue'}
  };
}

/* ---------- 3. Upload ---------- */
const stages = ['Uploading dataset', 'Reading file', 'Parsing CSV', 'Processing columns', 'Analyzing data', 'Preparing dashboard', 'Finalizing'];
async function uploadPage() {
  if (!S.token) return go('#/login');
  api('/api/config').then(c => maxMb = c.maxUploadMb).catch(() => {});
  let file = null, busy = false;
  app.innerHTML = `<main class="page light-page">${topnav(`<button class="btn ghost-dk sm" id="lo">Log out</button>`)}
  <div class="wrap narrow"><p class="eyebrow dk">Step 2 of 3</p><h1 class="h-lg">Upload Your Dataset</h1><p class="lead dk">Attach a CSV file. The server reads and analyses it for real — nothing here is pre-baked.</p>
  ${S.lost ? `<div class="msg err">${esc(S.lost)}</div>` : ''}
  <div class="drop" id="drop" tabindex="0" role="button" aria-label="Attach important file: drop a CSV here or press Enter to browse"><input type="file" id="pick" accept=".csv,text/csv" hidden>
    <div class="dz-ic" aria-hidden="true">⇪</div><h3>Attach Important File</h3><p>Drag &amp; drop a <b>.csv</b> here, or <u>browse</u></p><small>Max ${'<span id="mx">10</span>'} MB · comma, semicolon, tab or pipe delimited</small></div>
  <div class="chip" id="chip" hidden><div><b id="fn"></b><small id="fs"></small></div><div class="row"><button class="btn ghost-dk sm" id="swap">Replace</button><button class="btn ghost-dk sm" id="rm">Remove</button></div></div>
  <div class="msg" id="msg" role="alert" hidden></div>
  <div class="row"><button class="btn solid" id="run" disabled>Analyze dataset →</button>${S.aid ? '<a class="btn ghost-dk" href="#/dashboard">Back to current dashboard</a>' : ''}</div>
  <p class="note">No data of your own? <i>Sample data (not your analysis):</i> <a href="/api/samples/ledger.csv" download>sample ledger</a> · <a href="/api/samples/bank-statement.csv" download>sample bank statement</a></p></div>
  <div class="overlay" id="ov" hidden role="dialog" aria-modal="true" aria-label="Analysis progress"><div class="card dark prog"><h2 id="ph">Uploading dataset</h2><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="pbar"><i id="pfill"></i></div><div class="pct" id="ppct">0%</div>
    <ol class="steps" id="steps">${stages.slice(0, 1).concat(['Reading file', 'Processing columns', 'Analyzing data', 'Preparing dashboard']).map(s => `<li data-s="${s}">${s}</li>`).join('')}</ol><div class="msg err" id="perr" hidden></div><div class="row" id="pact" hidden><button class="btn solid sm" id="retry">Retry</button><button class="btn ghost sm" id="pclose">Choose another file</button></div></div></div></main>`;
  const $ = id => document.getElementById(id), msg = $('msg');
  document.getElementById('lo').onclick = () => logout();
  const setFile = f => {
    toast(msg, ''); file = null; $('run').disabled = true; $('chip').hidden = true; $('drop').hidden = false;
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return toast(msg, 'Only .csv files are supported.');
    if (!f.size) return toast(msg, 'That file is empty.');
    if (f.size > maxMb * 1048576) return toast(msg, `That file is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB.`);
    file = f; $('fn').textContent = f.name; $('fs').textContent = ' · ' + (f.size < 1024 ? f.size + ' B' : f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(2) + ' MB'); $('chip').hidden = false; $('drop').hidden = true; $('run').disabled = false;
  };
  const dz = $('drop'), pick = $('pick');
  dz.onclick = () => pick.click(); dz.onkeydown = e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); pick.click()}};
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => {e.preventDefault(); dz.classList.add('over')})); ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => {e.preventDefault(); dz.classList.remove('over')}));
  dz.addEventListener('drop', e => setFile(e.dataTransfer.files[0])); pick.onchange = () => {setFile(pick.files[0]); pick.value = ''};
  $('swap').onclick = () => pick.click(); $('rm').onclick = () => setFile(null);
  const prog = (stage, pct) => {$('ph').textContent = stage; $('pfill').style.width = pct + '%'; $('ppct').textContent = Math.round(pct) + '%'; $('pbar').setAttribute('aria-valuenow', Math.round(pct));
    const order = ['Uploading dataset', 'Reading file', 'Processing columns', 'Analyzing data', 'Preparing dashboard'], map = {'Parsing CSV': 'Reading file', 'Finalizing': 'Preparing dashboard', Done: 'Preparing dashboard'}, cur = order.indexOf(map[stage] || stage);
    $('steps').querySelectorAll('li').forEach((li, i) => li.className = i < cur || stage === 'Done' ? 'done' : i === cur ? 'now' : '')};
  const send = file => new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', '/api/upload'); x.setRequestHeader('Authorization', 'Bearer ' + S.token);
    x.upload.onprogress = e => e.lengthComputable && prog('Uploading dataset', e.loaded / e.total * 25);
    x.onload = () => {let b = {}; try {b = JSON.parse(x.responseText)} catch {} if (x.status === 401) {logout(false); go('#/login')} x.status === 202 ? res(b) : rej(Object.assign(new Error(b.error || 'Upload failed.'), {status: x.status}))};
    x.onerror = () => rej(new Error('Cannot reach the server. Is it running (npm start)?')); const fd = new FormData(); fd.append('file', file); x.send(fd);
  });
  const run = async () => {
    if (busy || !file) return; busy = true; $('run').disabled = true; $('ov').hidden = false; $('perr').hidden = true; $('pact').hidden = true; prog('Uploading dataset', 0);
    try {
      const {jobId} = await send(file); prog('Reading file', 25);
      for (;;) { // poll the REAL server job; progress reflects the backend's stage
        const j = await api('/api/jobs/' + jobId);
        if (j.status === 'error') throw new Error(j.error);
        prog(j.stage, 25 + j.progress * .75);
        if (j.status === 'done') {const a = await api('/api/analyses/' + j.analysisId); setAnalysis(a); prog('Done', 100); await new Promise(r => setTimeout(r, 350)); busy = false; return go('#/dashboard')}
        await new Promise(r => setTimeout(r, 120));
      }
    } catch (e) {$('ph').textContent = 'Analysis failed'; $('perr').textContent = e.message; $('perr').hidden = false; $('pact').hidden = false; busy = false}
  };
  $('run').onclick = run; $('retry').onclick = run; $('pclose').onclick = () => {$('ov').hidden = true; $('run').disabled = !file};
}

/* ---------- 4+. Dashboard ---------- */
const tabs = [['overview', 'Overview'], ['quality', 'Data Quality'], ['stats', 'Statistics'], ['explore', 'Explore']];
const X = {tab: 'dist', col: null, cat: null, num: null, agg: 'mean', top: 10, sx: null, sy: null, date: null, tnum: '__count', tagg: 'sum', scol: null, ccol: null};
async function dashboard(page = 'overview') {
  if (!S.token) return go('#/login');
  if (!S.aid) {S.lost = S.lost || ''; return go('#/upload')}
  const shell = body => `<main class="page dash">${topnav(`<a class="btn ghost-dk sm" href="#/upload">Upload new dataset</a><button class="btn ghost-dk sm" id="lo">Log out</button>`)}
    <div class="wrap"><nav class="tabs" aria-label="Dashboard">${tabs.map(([k, l]) => `<a href="#/dashboard/${k}" ${k === page ? 'aria-current="page" class="on"' : ''}>${l}</a>`).join('')}</nav>${body}</div></main>`;
  app.innerHTML = shell(`<div class="loading"><span class="spin"></span> Loading analysis…</div>`);
  let A; try {A = await ensureAnalysis()} catch (e) {
    app.innerHTML = shell(`<div class="card light center"><h2>${e.status === 404 ? 'Analysis not found' : 'Could not load analysis'}</h2><p>${esc(e.message)}</p><a class="btn solid" href="#/upload">Upload a dataset</a></div>`); return}
  const sub = `<p class="sub"><b>${esc(A.filename)}</b> · analysed ${new Date(A.uploadedAt).toLocaleString()} · delimiter ${A.delimiter === '\t' ? 'tab' : '“' + esc(A.delimiter) + '”'}</p>`;
  const body = {overview, quality, stats, explore}[page] || overview;
  app.innerHTML = shell(`<h1 class="h-lg">${tabs.find(t => t[0] === page)?.[1] || 'Overview'}</h1>${sub}${body(A)}`);
  document.getElementById('lo').onclick = () => logout();
  if (page === 'stats') bindStats(A); if (page === 'explore') bindExplore(A);
}
const kpi = (l, v, s = '', dark = false) => `<div class="kpi card ${dark ? 'dark' : 'light'}"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
const table = (head, rows, cls = '') => `<div class="tw"><table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const typeTag = t => `<span class="tag t-${t}">${t}</span>`;

function overview(A) {
  const s = A.summary, nums = A.columns.filter(c => c.stats);
  return `<div class="kpis">${kpi('Rows', fmt(s.rows, 0), 'records', true)}${kpi('Columns', s.columns, `${s.numeric} num · ${s.categorical} cat · ${s.date} date`)}${kpi('Missing cells', s.missingPct + '%', fmt(s.missingCells, 0) + ' cells')}${kpi('Duplicate rows', fmt(s.duplicateRows, 0), s.duplicatePct + '% of rows')}${kpi('Quality score', s.qualityScore, 'heuristic, out of 100', true)}</div>
  <section class="card dark"><h2>Key findings</h2><ul class="find">${A.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>
  <section class="card light"><h2>Columns</h2>${table(['Column', 'Type', 'Non-missing', 'Missing', 'Unique'], A.columns.map(c => [esc(c.name), typeTag(c.type), fmt(c.count, 0), `${fmt(c.missing, 0)} (${c.missingPct}%)`, fmt(c.unique, 0)]))}</section>
  <section class="card light"><h2>Numeric summary</h2>${nums.length ? table(['Column', 'Mean', 'Median', 'Min', 'Max', 'Std dev'], nums.map(c => [esc(c.name), fmt(c.stats.mean), fmt(c.stats.median), fmt(c.stats.min), fmt(c.stats.max), fmt(c.stats.std)])) : empty('This dataset has no numeric columns, so there are no numeric summaries.')}</section>
  <section class="card light"><h2>Dataset preview <small>(first ${A.preview.rows.length} rows)</small></h2>${table(A.preview.columns, A.preview.rows.map(r => r.map(esc)), 'prev')}</section>`;
}
function quality(A) {
  const s = A.summary, miss = A.columns.filter(c => c.missing > 0).sort((a, b) => b.missing - a.missing);
  return `<div class="grid2 gap"><section class="card dark qs"><h2>Quality score</h2>${gauge(s.qualityScore)}<p class="note">Heuristic from missing cells, duplicates, malformed rows, constant columns and outliers.</p></section>
  <section class="card light"><h2>Detected issues</h2>${A.issues.length ? `<ul class="issues">${A.issues.map(i => `<li class="sev-${i.severity}"><b>${i.severity}</b> ${esc(i.text)}</li>`).join('')}</ul>` : empty('No data-quality issues were detected.')}</section></div>
  <section class="card light"><h2>Missing values by column</h2>${miss.length ? bars(miss.map(c => ({label: c.name, value: c.missingPct, text: `${fmt(c.missing, 0)} · ${c.missingPct}%`})), {max: 100}) : empty('No missing values were detected.')}</section>
  <section class="card dark"><h2>Duplicate records</h2>${A.duplicates.count ? `<p>${fmt(A.duplicates.count, 0)} duplicate row(s) (${s.duplicatePct}%). Examples:</p>${table(['Row', 'Repeats row', 'Values'], A.duplicates.examples.map(e => [e.row, e.firstSeenRow, esc(e.values.join(', '))]))}` : empty('No duplicate rows were found.')}</section>
  <section class="card light"><h2>Column health</h2>${table(['Column', 'Type', 'Missing %', 'Unique', 'Outliers', 'Notes'], A.columns.map(c => [esc(c.name), typeTag(c.type), c.missingPct + '%', fmt(c.unique, 0), c.stats ? fmt(c.stats.outliers, 0) : '—', c.unique === 1 ? 'constant' : c.negatives ? `${c.negatives} negative` : ''].map(x => x)))}</section>`;
}
const sel = (id, opts, cur, label) => `<label class="ctl">${label}<select id="${id}">${opts.map(o => {const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`}).join('')}</select></label>`;
function stats(A) {
  const nums = A.columns.filter(c => c.stats), cats = A.columns.filter(c => c.topValues && (c.type === 'categorical' || c.type === 'boolean'));
  X.scol = nums.find(c => c.name === X.scol)?.name || nums[0]?.name; X.ccol = cats.find(c => c.name === X.ccol)?.name || cats[0]?.name;
  return `<section class="card light"><h2>Descriptive statistics</h2>${nums.length ? table(['Column', 'Count', 'Mean', 'Median', 'Min', 'Q1', 'Q3', 'Max', 'Std dev', 'Outliers'], nums.map(c => [esc(c.name), fmt(c.count, 0), fmt(c.stats.mean), fmt(c.stats.median), fmt(c.stats.min), fmt(c.stats.q1), fmt(c.stats.q3), fmt(c.stats.max), fmt(c.stats.std), c.stats.outliers])) : empty('This analysis requires a numerical column — none was found.')}</section>
  <div class="grid2 gap"><section class="card dark"><h2>Distribution</h2>${nums.length ? sel('scol', nums.map(c => c.name), X.scol, 'Column') + '<div id="shist"></div>' : empty('This chart requires a numerical column.')}</section>
  <section class="card light"><h2>Category frequencies</h2>${cats.length ? sel('ccol', cats.map(c => c.name), X.ccol, 'Column') + '<div id="cfreq"></div>' : empty('No categorical columns were detected.')}</section></div>
  <section class="card light"><h2>Correlation matrix</h2>${A.correlation ? heatmap(A.correlation) + `<h3>Strongest relationships</h3>${bars(A.correlation.topPairs.map(p => ({label: `${p.a} ↔ ${p.b}`, value: Math.abs(p.r), text: 'r = ' + p.r})), {max: 1})}` : empty('Correlation needs at least two numeric columns with variation.')}</section>`;
}
function bindStats(A) {
  const draw = () => {
    const h = document.getElementById('shist'); if (h) h.innerHTML = histogram(A.columns.find(c => c.name === X.scol).histogram);
    const f = document.getElementById('cfreq'); if (f) {const c = A.columns.find(c => c.name === X.ccol); f.innerHTML = bars(c.topValues.map(v => ({label: String(v.value), value: v.count, text: `${fmt(v.count, 0)} · ${v.pct}%`}))) + (c.unique > c.topValues.length ? `<p class="note">Showing top ${c.topValues.length} of ${fmt(c.unique, 0)} distinct values.</p>` : '')}
  };
  for (const id of ['scol', 'ccol']) {const el = document.getElementById(id); if (el) el.onchange = () => {X[id] = el.value; draw()}} draw();
}
function explore(A) {
  const av = A.availability, T = [['dist', 'Distribution'], ['cmp', 'Compare'], ['rel', 'Relationship'], ['trend', 'Trend']];
  return `<div class="seg" role="tablist" aria-label="Chart type">${T.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${X.tab === k}" class="${X.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><section class="card light" id="xp"></section>`;
}
function bindExplore(A) {
  const av = A.availability, p = document.getElementById('xp');
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {X.tab = b.dataset.t; document.querySelectorAll('.seg button').forEach(x => {x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b)}); draw()});
  const draw = () => {
    if (X.tab === 'dist') {
      if (!av.numeric.length) return p.innerHTML = '<h2>Distribution</h2>' + empty('This chart requires a numerical column.');
      X.col = av.numeric.includes(X.col) ? X.col : av.numeric[0]; const c = A.columns.find(c => c.name === X.col);
      p.innerHTML = `<h2>Distribution</h2>${sel('c1', av.numeric, X.col, 'Numeric column')}<div class="chips"><span>mean ${fmt(c.stats.mean)}</span><span>median ${fmt(c.stats.median)}</span><span>σ ${fmt(c.stats.std)}</span><span>${c.stats.outliers} outliers</span></div>${histogram(c.histogram)}`;
      document.getElementById('c1').onchange = e => {X.col = e.target.value; draw()};
    } else if (X.tab === 'cmp') {
      if (!av.categorical.length) return p.innerHTML = '<h2>Compare categories</h2>' + empty('No categorical column with a manageable number of categories (≤ 60) was found.');
      X.cat = av.categorical.includes(X.cat) ? X.cat : av.categorical[0]; const g = A.groups[X.cat], nums = av.numeric.filter(n => g[n]);
      const opts = [['__count', 'Row count'], ...nums.map(n => [n, n])]; if (!opts.some(o => o[0] === X.num)) X.num = '__count';
      let items;
      if (X.num === '__count') items = g.__count.map(r => ({label: r.key, value: r.count})); else {const k = X.agg; items = g[X.num].filter(r => r[k] != null).map(r => ({label: r.key, value: r[k]})).sort((a, b) => b.value - a.value)}
      items = items.slice(0, X.top);
      p.innerHTML = `<h2>Compare categories</h2><div class="ctls">${sel('c1', av.categorical, X.cat, 'Group by')}${sel('c2', opts, X.num, 'Measure')}${X.num !== '__count' ? sel('c3', [['mean', 'Average'], ['sum', 'Total']], X.agg, 'Aggregate') : ''}${sel('c4', [[5, 'Top 5'], [10, 'Top 10'], [20, 'Top 20'], [30, 'Top 30']], String(X.top), 'Show')}</div>${items.length ? bars(items) : empty('No values to compare for this selection.')}`;
      document.getElementById('c1').onchange = e => {X.cat = e.target.value; draw()}; document.getElementById('c2').onchange = e => {X.num = e.target.value; draw()}; document.getElementById('c4').onchange = e => {X.top = +e.target.value; draw()};
      const c3 = document.getElementById('c3'); if (c3) c3.onchange = e => {X.agg = e.target.value; draw()};
    } else if (X.tab === 'rel') {
      const sc = Object.keys(A.scatter), nm = [...new Set(sc.flatMap(k => k.split('|')))];
      if (nm.length < 2) return p.innerHTML = '<h2>Relationship</h2>' + empty('A scatter plot requires at least two numerical columns with variation.');
      if (!nm.includes(X.sx)) X.sx = nm[0]; if (!nm.includes(X.sy) || X.sy === X.sx) X.sy = nm.find(n => n !== X.sx);
      const key = [X.sx, X.sy].sort((a, b) => nm.indexOf(a) - nm.indexOf(b)).join('|'), d = A.scatter[key], flip = key.split('|')[0] !== X.sx;
      const pts = d ? d.points.map(q => flip ? [q[1], q[0]] : q) : [], r = A.correlation?.matrix[A.correlation.columns.indexOf(X.sx)]?.[A.correlation.columns.indexOf(X.sy)];
      p.innerHTML = `<h2>Relationship</h2><div class="ctls">${sel('c1', nm, X.sx, 'X axis')}${sel('c2', nm, X.sy, 'Y axis')}</div>${r != null ? `<div class="chips"><span>Pearson r = ${r}</span><span>${d.total} paired rows${d.total > pts.length ? ` (showing ${pts.length})` : ''}</span></div>` : ''}${scatter(pts, X.sx, X.sy)}`;
      document.getElementById('c1').onchange = e => {X.sx = e.target.value; draw()}; document.getElementById('c2').onchange = e => {X.sy = e.target.value; draw()};
    } else {
      if (!av.date.length) return p.innerHTML = '<h2>Trend</h2>' + empty('A trend chart requires a date column — none was detected.');
      X.date = av.date.includes(X.date) ? X.date : av.date[0]; const t = A.trends[X.date], nums = av.numeric.filter(n => t.points[0]?.sums && n in t.points[0].sums);
      const opts = [['__count', 'Row count'], ...nums.map(n => [n, n])]; if (!opts.some(o => o[0] === X.tnum)) X.tnum = '__count';
      const pts = t.points.map(q => ({t: q.t, v: X.tnum === '__count' ? q.count : (X.tagg === 'sum' ? q.sums : q.means)[X.tnum]}));
      p.innerHTML = `<h2>Trend over time</h2><div class="ctls">${sel('c1', av.date, X.date, 'Date column')}${sel('c2', opts, X.tnum, 'Measure')}${X.tnum !== '__count' ? sel('c3', [['sum', 'Total'], ['mean', 'Average']], X.tagg, 'Aggregate') : ''}</div><p class="note">Grouped by ${t.granularity}.</p>${line(pts, X.tnum === '__count' ? 'row count' : X.tnum)}`;
      document.getElementById('c1').onchange = e => {X.date = e.target.value; draw()}; document.getElementById('c2').onchange = e => {X.tnum = e.target.value; draw()};
      const c3 = document.getElementById('c3'); if (c3) c3.onchange = e => {X.tagg = e.target.value; draw()};
    }
  };
  draw();
}

/* ---------- router ---------- */
async function route() {
  cleanup?.(); cleanup = null; window.scrollTo(0, 0);
  const [, a, b] = (location.hash.replace(/^#/, '') || '/').split('/');
  const pg = a || '';
  if (pg === 'about') return about();
  if (pg === 'login') return login();
  if (pg === 'upload') return uploadPage();
  if (pg === 'dashboard') return dashboard(b || 'overview');
  return landing();
}
addEventListener('hashchange', route); route();
