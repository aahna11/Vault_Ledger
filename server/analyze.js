// Real CSV analysis engine. Everything returned is computed from the uploaded bytes.
// Dependency-free CSV parser (RFC-4180 style quotes, any single-char delimiter).
export function parseCSV(text, d) {
  const rows = []; let row = [], f = '', q = false, i = 0; const n = text.length;
  const endField = () => {row.push(f.trim()); f = ''};
  const endRow = () => {endField(); if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []};
  while (i < n) {
    const c = text[i];
    if (q) {if (c === '"') {if (text[i + 1] === '"') {f += '"'; i += 2; continue} q = false; i++; continue} f += c; i++; continue}
    if (c === '"' && f.trim() === '') {q = true; i++; continue}
    if (c === d) {endField(); i++; continue}
    if (c === '\r') {i++; continue}
    if (c === '\n') {endRow(); i++; continue}
    f += c; i++;
  }
  if (q) throw new Error('a quoted field is never closed (unbalanced quote)');
  if (f !== '' || row.length) endRow();
  return rows;
}

export class AppError extends Error {constructor(status, message) {super(message); this.status = status}}

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '-', '--', '?']);
const isMissing = v => v == null || MISSING.has(String(v).trim().toLowerCase());
const numRe = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const dateRe = /^(\d{4}-\d{1,2}-\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})$/;
const BOOL = new Set(['true', 'false', 'yes', 'no', 't', 'f', 'y', 'n']);
const tick = () => new Promise(r => setImmediate(r));

export function toNum(v) {
  let s = String(v).trim().replace(/^[₹$€£]\s?/, '').replace(/\s?%$/, '');
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  return numRe.test(s) ? parseFloat(s) : NaN;
}
export function toDate(v) {
  const s = String(v).trim();
  if (!dateRe.test(s)) return NaN;
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {let [, a, b, y] = m.map(Number); if (y < 100) y += 2000; let d = a, mo = b; if (mo > 12) [d, mo] = [mo, d]; return mo > 12 ? NaN : Date.UTC(y, mo - 1, d)}
  return Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s);
}
export function decode(buf) {
  if (buf.includes(0) && !(buf[0] === 0xFF && buf[1] === 0xFE)) throw new AppError(415, 'This file looks binary, not text. Please upload a real CSV file.');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le').replace(/^﻿/, '');
  let s = buf.toString('utf8');
  if (s.includes('�')) s = buf.toString('latin1');
  return s.replace(/^﻿/, '');
}
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
  let best = ',', score = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => l.split(d).length - 1), first = counts[0];
    if (!first) continue;
    const sc = counts.filter(c => c === first).length * 1000 + first;
    if (sc > score) {score = sc; best = d}
  }
  return best;
}
const round = (x, d = 4) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
const quantile = (sorted, q) => {const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo)};
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 3) return null;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) {sx += xs[i]; sy += ys[i]}
  const mx = sx / n, my = sy / n; let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {const a = xs[i] - mx, b = ys[i] - my; nu += a * b; dx += a * a; dy += b * b}
  return dx && dy ? nu / Math.sqrt(dx * dy) : null;
};

function inferType(vals, name, nRows) {
  const nm = vals.length;
  if (!nm) return 'empty';
  const numeric = vals.filter(v => !Number.isNaN(toNum(v))).length;
  if (numeric / nm >= 0.95) return 'numeric';
  if (vals.every(v => BOOL.has(String(v).trim().toLowerCase()))) return 'boolean';
  const dates = vals.filter(v => !Number.isNaN(toDate(v))).length;
  if (dates / nm >= 0.95) return 'date';
  const uniq = new Set(vals).size;
  if (uniq === nm && nm > 20 && /(^|_|\s)(id|ref|key|code|number|no)$/i.test(name)) return 'identifier';
  if (uniq <= Math.max(20, nRows * 0.05) || uniq / nm <= 0.5) return 'categorical';
  return 'text';
}

export async function analyze(buffer, filename, progress = () => {}, limits = {}) {
  const maxRows = limits.maxRows || 200000;
  progress('Reading file', 12); await tick();
  const text = decode(buffer);
  if (!text.trim()) throw new AppError(422, 'The file is empty.');
  const delimiter = detectDelimiter(text);
  progress('Parsing CSV', 25); await tick();
  let records;
  try {records = parseCSV(text, delimiter)}
  catch (e) {throw new AppError(422, 'Malformed CSV: ' + (e.message || 'could not be parsed') + '. Check for unbalanced quotes or broken rows.')}
  if (records.length < 2) throw new AppError(422, 'The CSV needs a header row and at least one data row.');
  let header = records[0].map((h, i) => String(h).trim() || `column_${i + 1}`);
  const seen = {}; header = header.map(h => {seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h}_${seen[h]}` : h});
  const W = header.length;
  if (W === 1 && header[0].length > 80) throw new AppError(422, 'This does not look like a CSV table (no delimiters found).');
  let rows = records.slice(1);
  if (rows.length > maxRows) throw new AppError(413, `Too many rows (${rows.length.toLocaleString()}). The limit is ${maxRows.toLocaleString()}.`);
  const badRows = [];
  rows.forEach((r, i) => {if (r.length !== W) badRows.push(i + 2)});
  if (badRows.length / rows.length > 0.3) throw new AppError(422, `Malformed CSV: ${badRows.length} of ${rows.length} rows do not have ${W} fields like the header (first bad line: ${badRows[0]}).`);
  rows = rows.map(r => r.length === W ? r : Array.from({length: W}, (_, i) => r[i] ?? ''));
  const N = rows.length;

  progress('Processing columns', 45); await tick();
  const cols = header.map((name, c) => {
    const raw = rows.map(r => r[c]);
    const vals = raw.filter(v => !isMissing(v));
    return {name, raw, vals, type: inferType(vals, name, N)};
  });

  progress('Analyzing data', 65); await tick();
  const columns = [], numericData = {}, issues = [];
  for (const col of cols) {
    const missing = N - col.vals.length, uniq = new Set(col.vals);
    const info = {name: col.name, type: col.type, count: col.vals.length, missing, missingPct: round(missing / N * 100, 2), unique: uniq.size};
    if (col.type === 'numeric') {
      const nums = col.vals.map(toNum).filter(x => !Number.isNaN(x));
      const sorted = [...nums].sort((a, b) => a - b), n = sorted.length;
      const sum = nums.reduce((a, b) => a + b, 0), mean = sum / n;
      const std = n > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
      const q1 = quantile(sorted, .25), q3 = quantile(sorted, .75), iqr = q3 - q1;
      const outliers = iqr > 0 ? nums.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length : 0;
      const min = sorted[0], max = sorted[n - 1];
      const k = Math.max(5, Math.min(20, Math.ceil(Math.log2(n)) + 1)), w = (max - min) / k || 1;
      const bins = Array.from({length: min === max ? 1 : k}, (_, i) => ({x0: min + i * w, x1: min === max ? max : min + (i + 1) * w, count: 0}));
      for (const x of nums) bins[Math.min(bins.length - 1, Math.floor((x - min) / w))].count++;
      info.stats = {mean: round(mean), median: round(quantile(sorted, .5)), min: round(min), max: round(max), std: round(std), q1: round(q1), q3: round(q3), sum: round(sum), outliers};
      info.histogram = bins.map(b => ({x0: round(b.x0), x1: round(b.x1), count: b.count}));
      info.negatives = nums.filter(x => x < 0).length;
      numericData[col.name] = col.raw.map(v => isMissing(v) ? NaN : toNum(v));
    } else if (col.type === 'date') {
      const ts = col.vals.map(toDate).filter(x => !Number.isNaN(x)).sort((a, b) => a - b);
      info.dateRange = {min: new Date(ts[0]).toISOString().slice(0, 10), max: new Date(ts[ts.length - 1]).toISOString().slice(0, 10), spanDays: Math.round((ts[ts.length - 1] - ts[0]) / 864e5)};
    } else if (col.type !== 'empty') {
      const freq = new Map(); for (const v of col.vals) freq.set(v, (freq.get(v) || 0) + 1);
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).slice(0, 15);
      info.topValues = top.map(([value, count]) => ({value, count, pct: round(count / col.vals.length * 100, 2)}));
      info.mode = top[0]?.[0] ?? null;
    }
    columns.push(info);
    if (col.type === 'empty') issues.push({severity: 'high', column: col.name, text: `Column "${col.name}" is completely empty.`});
    else {
      if (info.missingPct >= 20) issues.push({severity: 'high', column: col.name, text: `"${col.name}" is missing ${info.missingPct}% of values (${missing.toLocaleString()} rows).`});
      else if (missing > 0) issues.push({severity: 'low', column: col.name, text: `"${col.name}" has ${missing.toLocaleString()} missing value(s) (${info.missingPct}%).`});
      if (info.unique === 1 && N > 1) issues.push({severity: 'medium', column: col.name, text: `"${col.name}" has a single constant value ("${col.vals[0]}") and carries no information.`});
      if (info.stats?.outliers) issues.push({severity: 'low', column: col.name, text: `"${col.name}" has ${info.stats.outliers} statistical outlier(s) (1.5×IQR rule).`});
      if (col.type === 'text' && info.unique / Math.max(1, info.count) > 0.9) issues.push({severity: 'low', column: col.name, text: `"${col.name}" is almost entirely unique text; it may be an identifier or free text.`});
      if (col.type === 'identifier' && info.unique < info.count) issues.push({severity: 'medium', column: col.name, text: `Identifier "${col.name}" contains repeated values.`});
    }
  }

  // duplicates (whole-row)
  const rowKey = new Map(), dupExamples = []; let dupCount = 0;
  rows.forEach((r, i) => {const k = r.join('\u0001'); if (rowKey.has(k)) {dupCount++; if (dupExamples.length < 5) dupExamples.push({row: i + 2, firstSeenRow: rowKey.get(k), values: r.slice(0, 8)})} else rowKey.set(k, i + 2)});
  if (dupCount) issues.push({severity: dupCount / N > .05 ? 'high' : 'medium', column: null, text: `${dupCount.toLocaleString()} fully duplicated row(s) (${round(dupCount / N * 100, 2)}%).`});
  if (badRows.length) issues.push({severity: 'medium', column: null, text: `${badRows.length} row(s) had a different number of fields than the header and were padded/truncated (first at line ${badRows[0]}).`});
  if (delimiter !== ',') issues.push({severity: 'low', column: null, text: `Detected delimiter: ${delimiter === '\t' ? 'tab' : '"' + delimiter + '"'}.`});

  progress('Preparing dashboard', 82); await tick();
  const numCols = columns.filter(c => c.type === 'numeric').map(c => c.name);
  const catCols = columns.filter(c => c.type === 'categorical' || c.type === 'boolean').map(c => c.name);
  const dateCols = columns.filter(c => c.type === 'date').map(c => c.name);
  const analysable = numCols.filter(n => columns.find(c => c.name === n).unique > 1).slice(0, 12);

  // correlation
  let correlation = null; const pairs = [];
  if (analysable.length >= 2) {
    const matrix = analysable.map(() => analysable.map(() => null));
    for (let i = 0; i < analysable.length; i++) for (let j = i; j < analysable.length; j++) {
      const xs = [], ys = [], A = numericData[analysable[i]], B = numericData[analysable[j]];
      for (let r = 0; r < N; r++) if (!Number.isNaN(A[r]) && !Number.isNaN(B[r])) {xs.push(A[r]); ys.push(B[r])}
      const v = i === j ? 1 : round(pearson(xs, ys), 3); matrix[i][j] = matrix[j][i] = v;
      if (i !== j && v != null) pairs.push({a: analysable[i], b: analysable[j], r: v, n: xs.length});
    }
    pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
    correlation = {columns: analysable, matrix, topPairs: pairs.slice(0, 8)};
  }
  // scatter samples (deterministic stride) for up to 6 numeric columns
  const scatter = {}, sc = analysable.slice(0, 6);
  for (let i = 0; i < sc.length; i++) for (let j = i + 1; j < sc.length; j++) {
    const A = numericData[sc[i]], B = numericData[sc[j]], pts = [];
    const idx = []; for (let r = 0; r < N; r++) if (!Number.isNaN(A[r]) && !Number.isNaN(B[r])) idx.push(r);
    const step = Math.max(1, Math.ceil(idx.length / 400)); for (let k = 0; k < idx.length; k += step) pts.push([round(A[idx[k]]), round(B[idx[k]])]);
    scatter[`${sc[i]}|${sc[j]}`] = {points: pts, total: idx.length};
  }
  // group-by: category × numeric
  const groups = {};
  for (const cn of catCols.filter(c => columns.find(x => x.name === c).unique <= 60).slice(0, 5)) {
    const ci = header.indexOf(cn); groups[cn] = {};
    const m = new Map(); rows.forEach((r, ri) => {if (!isMissing(r[ci])) {if (!m.has(r[ci])) m.set(r[ci], []); m.get(r[ci]).push(ri)}});
    const keys = [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 30);
    groups[cn].__count = keys.map(([key, ix]) => ({key, count: ix.length}));
    for (const nn of analysable.slice(0, 8)) {
      groups[cn][nn] = keys.map(([key, ix]) => {const v = ix.map(i => numericData[nn][i]).filter(x => !Number.isNaN(x)); const s = v.reduce((a, b) => a + b, 0); return {key, count: v.length, sum: round(s), mean: v.length ? round(s / v.length) : null}});
    }
  }
  // trends
  const trends = {};
  for (const dn of dateCols.slice(0, 2)) {
    const di = header.indexOf(dn), info = columns.find(c => c.name === dn), gran = info.dateRange.spanDays > 90 ? 'month' : 'day';
    const m = new Map();
    rows.forEach((r, ri) => {const t = toDate(r[di]); if (Number.isNaN(t)) return; const k = new Date(t).toISOString().slice(0, gran === 'month' ? 7 : 10); if (!m.has(k)) m.set(k, []); m.get(k).push(ri)});
    const keys = [...m.keys()].sort();
    trends[dn] = {granularity: gran, points: keys.map(k => {const ix = m.get(k), o = {t: k, count: ix.length, sums: {}, means: {}};
      for (const nn of analysable.slice(0, 8)) {const v = ix.map(i => numericData[nn][i]).filter(x => !Number.isNaN(x)); const s = v.reduce((a, b) => a + b, 0); o.sums[nn] = round(s); o.means[nn] = v.length ? round(s / v.length) : null}
      return o})};
  }

  // quality score (heuristic)
  const cells = N * W, missCells = columns.reduce((a, c) => a + c.missing, 0);
  const outlierCols = columns.filter(c => c.stats?.outliers).length, constCols = columns.filter(c => c.unique === 1).length;
  const score = Math.max(0, Math.round(100 - Math.min(40, missCells / cells * 100 * 1.5) - Math.min(25, dupCount / N * 100 * 2) - Math.min(15, badRows.length / N * 100) - Math.min(10, constCols * 3) - Math.min(10, outlierCols * 2)));

  const findings = [`${N.toLocaleString()} rows × ${W} columns (${numCols.length} numeric, ${catCols.length} categorical, ${dateCols.length} date).`];
  const worst = [...columns].sort((a, b) => b.missing - a.missing)[0];
  findings.push(worst.missing ? `Most missing values: "${worst.name}" (${worst.missingPct}%).` : 'No missing values were detected.');
  findings.push(dupCount ? `${dupCount.toLocaleString()} duplicate row(s) found.` : 'No duplicate rows were found.');
  if (pairs[0]) findings.push(`Strongest numeric relationship: ${pairs[0].a} vs ${pairs[0].b} (r = ${pairs[0].r}).`);
  const catTop = columns.find(c => c.topValues && c.type === 'categorical');
  if (catTop) findings.push(`Most common "${catTop.name}": ${catTop.topValues[0].value} (${catTop.topValues[0].pct}%).`);
  const numTop = columns.find(c => c.stats);
  if (numTop) findings.push(`"${numTop.name}" ranges from ${numTop.stats.min} to ${numTop.stats.max} (mean ${numTop.stats.mean}).`);

  const preview = {columns: header, rows: rows.slice(0, 25)};
  progress('Finalizing', 95); await tick();
  return {
    filename, uploadedAt: new Date().toISOString(), delimiter,
    summary: {rows: N, columns: W, numeric: numCols.length, categorical: catCols.length, date: dateCols.length, missingCells: missCells, missingPct: round(missCells / cells * 100, 2), duplicateRows: dupCount, duplicatePct: round(dupCount / N * 100, 2), inconsistentRows: badRows.length, qualityScore: score},
    findings, columns, issues: issues.sort((a, b) => ({high: 0, medium: 1, low: 2}[a.severity] - {high: 0, medium: 1, low: 2}[b.severity])),
    duplicates: {count: dupCount, examples: dupExamples}, correlation, scatter, groups, trends, preview,
    availability: {numeric: analysable, categorical: Object.keys(groups), date: Object.keys(trends)},
  };
}
