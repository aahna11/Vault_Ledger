// Tiny dependency-free SVG/HTML chart helpers. All colours use currentColor so they work on light and dark cards.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const fmt = (n, d = 2) => n == null || Number.isNaN(n) ? '—' : Math.abs(n) >= 1e6 ? new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 2}).format(n) : Number(n).toLocaleString('en', {maximumFractionDigits: d});
export const empty = msg => `<div class="empty">${esc(msg)}</div>`;
function ticks(min, max, n = 4) {
  if (min === max) return [min];
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag, step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toPrecision(12)); return out;
}
export function bars(items, {unit = '', max} = {}) {
  if (!items.length) return empty('No data to display.');
  const m = max ?? Math.max(...items.map(i => i.value), 1e-9);
  return `<ul class="bars">${items.map(i => `<li title="${esc(i.label)}: ${esc(fmt(i.value))}${unit}"><span class="bl">${esc(i.label)}</span><span class="bt"><i style="width:${Math.max(1.5, i.value / m * 100)}%"></i></span><span class="bv">${esc(i.text ?? fmt(i.value) + unit)}</span></li>`).join('')}</ul>`;
}
export function histogram(bins) {
  if (!bins?.length) return empty('No numeric values available.');
  const W = 640, H = 240, p = {l: 44, r: 8, t: 10, b: 30}, mx = Math.max(...bins.map(b => b.count), 1), bw = (W - p.l - p.r) / bins.length;
  const yt = ticks(0, mx, 4);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Histogram">${yt.map(t => {const y = H - p.b - t / mx * (H - p.t - p.b); return `<line x1="${p.l}" x2="${W - p.r}" y1="${y}" y2="${y}" class="grid"/><text x="${p.l - 6}" y="${y + 3}" text-anchor="end">${fmt(t, 0)}</text>`}).join('')}
  ${bins.map((b, i) => {const h = b.count / mx * (H - p.t - p.b); return `<rect x="${p.l + i * bw + 1}" y="${H - p.b - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" class="mark"><title>${fmt(b.x0)} – ${fmt(b.x1)}: ${b.count} rows</title></rect>`}).join('')}
  <text x="${p.l}" y="${H - 10}">${fmt(bins[0].x0)}</text><text x="${W - p.r}" y="${H - 10}" text-anchor="end">${fmt(bins[bins.length - 1].x1)}</text></svg>`;
}
export function scatter(points, xl, yl) {
  if (!points?.length) return empty('Not enough paired values for a scatter plot.');
  const W = 640, H = 300, p = {l: 52, r: 10, t: 10, b: 36}, xs = points.map(q => q[0]), ys = points.map(q => q[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); if (x0 === x1) {x0 -= 1; x1 += 1} if (y0 === y1) {y0 -= 1; y1 += 1}
  const X = v => p.l + (v - x0) / (x1 - x0) * (W - p.l - p.r), Y = v => H - p.b - (v - y0) / (y1 - y0) * (H - p.t - p.b);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Scatter plot of ${esc(yl)} against ${esc(xl)}">
  ${ticks(y0, y1).map(t => `<line x1="${p.l}" x2="${W - p.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${p.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('')}
  ${ticks(x0, x1).map(t => `<text x="${X(t)}" y="${H - 18}" text-anchor="middle">${fmt(t)}</text>`).join('')}
  ${points.map(q => `<circle cx="${X(q[0])}" cy="${Y(q[1])}" r="3.2" class="dot"><title>${esc(xl)} ${fmt(q[0])}, ${esc(yl)} ${fmt(q[1])}</title></circle>`).join('')}
  <text x="${(W + p.l) / 2}" y="${H - 3}" text-anchor="middle" class="axl">${esc(xl)}</text><text transform="translate(11 ${H / 2}) rotate(-90)" text-anchor="middle" class="axl">${esc(yl)}</text></svg>`;
}
export function line(pts, label) {
  const v = pts.filter(q => q.v != null); if (v.length < 2) return empty('At least two time buckets are needed for a trend line.');
  const W = 640, H = 260, p = {l: 52, r: 10, t: 10, b: 30}, y0 = Math.min(0, ...v.map(q => q.v)), y1 = Math.max(...v.map(q => q.v), y0 + 1e-9);
  const X = i => p.l + i / (pts.length - 1) * (W - p.l - p.r), Y = val => H - p.b - (val - y0) / (y1 - y0) * (H - p.t - p.b);
  const path = pts.map((q, i) => q.v == null ? '' : `${i && pts[i - 1].v != null ? 'L' : 'M'}${X(i)},${Y(q.v)}`).join('');
  const step = Math.ceil(pts.length / 6);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Trend of ${esc(label)}">${ticks(y0, y1).map(t => `<line x1="${p.l}" x2="${W - p.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${p.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('')}
  <path d="${path}" class="ln"/>${pts.map((q, i) => q.v == null ? '' : `<circle cx="${X(i)}" cy="${Y(q.v)}" r="3.5" class="dot"><title>${esc(q.t)}: ${fmt(q.v)}</title></circle>`).join('')}
  ${pts.map((q, i) => i % step ? '' : `<text x="${X(i)}" y="${H - 10}" text-anchor="middle">${esc(q.t)}</text>`).join('')}</svg>`;
}
export function heatmap(c) {
  const n = c.columns.length;
  return `<div class="heat-wrap"><table class="heat"><thead><tr><th></th>${c.columns.map(h => `<th title="${esc(h)}">${esc(h.length > 10 ? h.slice(0, 9) + '…' : h)}</th>`).join('')}</tr></thead><tbody>${c.matrix.map((row, i) => `<tr><th title="${esc(c.columns[i])}">${esc(c.columns[i].length > 14 ? c.columns[i].slice(0, 13) + '…' : c.columns[i])}</th>${row.map(v => `<td class="${v != null && v < 0 ? 'neg' : ''}" style="--a:${v == null ? 0 : Math.abs(v)}" title="r = ${v ?? 'n/a'}">${v == null ? '–' : v.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="note">Solid = positive, dashed outline = negative correlation. Opacity = strength (Pearson r).</p></div>`;
}
export function gauge(score) {
  const r = 52, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 130 130" class="gauge" role="img" aria-label="Quality score ${score} of 100"><circle cx="65" cy="65" r="${r}" class="gtrack"/><circle cx="65" cy="65" r="${r}" class="gfill" stroke-dasharray="${c * score / 100} ${c}" transform="rotate(-90 65 65)"/><text x="65" y="63" text-anchor="middle" class="gnum">${score}</text><text x="65" y="82" text-anchor="middle" class="gsub">/ 100</text></svg>`;
}
