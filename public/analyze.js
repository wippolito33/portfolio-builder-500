// Portfolio Builder 500: analyze a portfolio and test replacing one position.
// Everything here runs in the browser. Positions files are never uploaded;
// only ticker symbols are sent to /api/history to fetch price history.

const BENCH = "SPY";
const CONCURRENCY = 3;
const SIMS = 4000;
const C = { cur: "#3E7CB1", swap: "#B7791F", bench: "#8A96A3" };
const BAND = { cur: "rgba(62,124,177,0.14)", swap: "rgba(183,121,31,0.16)" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (v, d = 0) => v == null || !isFinite(v) ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v, d = 1, sign = true) => v == null || !isFinite(v) ? "—" : (sign && v > 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const cls = (v) => v == null || !isFinite(v) ? "" : v >= 0 ? "up" : "down";
const monthKey = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const keyLabel = (k) => new Date(Date.UTC(Math.floor(k / 12), k % 12, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const state = {
  holdings: [],      // { symbol, name, shares, value, cost, gain, isCash, status, error }
  series: {},        // symbol -> { map: Map(monthKey -> adjClose), first, last } | { error }
  endK: null,
  rateLimited: false,
  analysis: null,    // last swap analysis
  period: 5,
  horizon: 5,
  charts: {},
};

// ---------------------------------------------------------------- parsing

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((s) => s.trim()));
}

function num(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t || t === "--" || t.toLowerCase() === "n/a") return null;
  const neg = /^\(.*\)$/.test(t);
  t = t.replace(/[()$,%\s]/g, "");
  const v = parseFloat(t);
  return isFinite(v) ? (neg ? -v : v) : null;
}

const isCashLike = (sym, name) =>
  /\b(deposit|deposits|money market|cash|sweep)\b/i.test(name || "") || /^(CASH|BDP\b|BDP-)/i.test(sym || "");

const cleanSym = (s) => String(s || "").toUpperCase().replace(/^\*+/, "").replace(/\//g, "-").trim();

function holdingsFromCSV(text) {
  const rows = parseCSV(text).filter((r) => r.some((c) => c));
  const hi = rows.findIndex((r) => r.some((c) => /^(symbol|ticker)$/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find a Symbol or Ticker column in this file.");
  const head = rows[hi].map((h) => h.toLowerCase());
  const col = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iSym = col(/^(symbol|ticker)$/);
  const iQty = col(/^(quantity|qty|shares)$/);
  const iName = col(/^(name|description|security|security description)$/);
  const iPrice = col(/^(price|last price|current price)$/);
  const iMV = col(/market value|^value$|current value/);
  const iCost = col(/net cost|cost basis|total cost/);
  const iGain = col(/unrealized/, /%|percent/);
  if (iQty < 0 && iMV < 0) throw new Error("Couldn't find a Quantity or Market Value column in this file.");

  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const symbol = cleanSym(r[iSym]);
    if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) continue; // footers, disclaimers
    const name = iName >= 0 ? r[iName] : "";
    const shares = iQty >= 0 ? num(r[iQty]) : null;
    const price = iPrice >= 0 ? num(r[iPrice]) : null;
    let value = iMV >= 0 ? num(r[iMV]) : null;
    if (value == null && shares != null && price != null) value = shares * price;
    const cost = iCost >= 0 ? num(r[iCost]) : null;
    let gain = iGain >= 0 ? num(r[iGain]) : null;
    if (gain == null && cost != null && value != null) gain = value - cost;
    out.push({ symbol, name, shares, value, cost, gain, isCash: isCashLike(symbol, name) });
  }
  if (!out.length) throw new Error("No holdings found in this file.");
  return out;
}

function holdingsFromText(text) {
  const out = [];
  const bad = [];
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[,\t]+|\s+/).filter(Boolean);
    const symbol = cleanSym(parts[0]);
    const a = num(parts[1]);
    const cost = num(parts[2]);
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol) || a == null) { bad.push(t); continue; }
    if (isCashLike(symbol, "")) out.push({ symbol: "CASH", name: "Cash", shares: null, value: a, cost: a, gain: 0, isCash: true });
    else out.push({ symbol, name: "", shares: a, value: null, cost, gain: null, isCash: false });
  }
  if (bad.length) throw new Error(`Couldn't read: ${bad.slice(0, 3).join("; ")}. Use "TICKER, shares" on each line.`);
  if (!out.length) throw new Error("Enter at least one holding.");
  return out;
}

// ---------------------------------------------------------------- data

const isLimit = (msg) => /\b429\b|rate limit|request limit|hourly|allocation|credit limit/i.test(msg || "");

// Returns a series, or { error, rateLimited }. Failures aren't remembered, so a
// later retry can succeed.
async function fetchSeries(sym) {
  if (state.series[sym]) return state.series[sym];
  let data;
  try {
    const r = await fetch("/api/history?symbols=" + encodeURIComponent(sym));
    data = await r.json().catch(() => null);
    if (!data) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    return { error: String(e.message || e) };
  }
  const pts = data.series && data.series[sym];
  if (!Array.isArray(pts) || pts.length < 2) {
    const err = (pts && pts.error) || data.message || "No price history";
    return { error: err, rateLimited: !!((pts && pts.rateLimited) || data.rateLimited || isLimit(err)) };
  }
  const map = new Map();
  for (const p of pts) map.set(monthKey(p.t), p.p);
  const keys = [...map.keys()];
  const m = (data.meta && data.meta[sym]) || {};
  return (state.series[sym] = {
    map, first: Math.min(...keys), last: Math.max(...keys), lastPrice: pts[pts.length - 1].p,
    source: m.source || "tiingo", adjusted: m.adjusted !== false,
  });
}

const WAIT_SECONDS = 60;   // Twelve Data's limit resets every minute
const MAX_WAITS = 8;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Loads every symbol. When both data providers say "slow down", waits a
// minute and continues with whatever is left, up to MAX_WAITS times.
async function loadAll(symbols, onProgress, onWait) {
  const results = {};
  let pending = [...symbols];
  let done = 0;
  state.stopWaiting = false;
  for (let round = 0; pending.length && round <= MAX_WAITS; round++) {
    if (round > 0) {
      for (let s = WAIT_SECONDS; s > 0 && !state.stopWaiting; s--) { onWait(s, done, symbols.length); await sleep(1000); }
      if (state.stopWaiting) break;
    }
    const queue = [...pending];
    const retry = [];
    let hit = false;
    async function worker() {
      while (queue.length && !hit) {
        const sym = queue.shift();
        const r = await fetchSeries(sym);
        results[sym] = r;
        if (r.rateLimited) { hit = true; retry.push(sym); }
        else onProgress(++done, symbols.length);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    pending = retry.concat(queue);
  }
  return results;
}

const ret = (s, k) => {
  if (!s || !s.map) return null;
  const a = s.map.get(k - 1), b = s.map.get(k);
  return a && b ? b / a - 1 : null;
};

// ---------------------------------------------------------------- holdings

async function loadHoldings(list, sourceLabel, name = "") {
  state.holdings = list;
  $("saveName").value = name;
  $("saveMsg").textContent = "";
  state.analysis = null;
  $("results").hidden = true;
  $("swapMsg").innerHTML = "";
  $("loadMsg").innerHTML = "";
  $("holdings").hidden = false;
  $("swap").hidden = true;
  $("holdNote").textContent = sourceLabel;
  renderHoldings();
  renderSectors();

  const syms = [...new Set(list.filter((h) => !h.isCash).map((h) => h.symbol).concat(BENCH))];
  $("progress").textContent = `Loading price history: 0 of ${syms.length}`;
  const loaded = await loadAll(
    syms,
    (d, n) => ($("progress").textContent = `Loading price history: ${d} of ${n}`),
    (secs, d, n) => ($("progress").innerHTML =
      `Loaded ${d} of ${n}. The free data plans allow only so many requests a minute, so loading continues in ${secs}s. ` +
      `<button type="button" class="ghost" id="stopWait">Analyze with what's loaded</button>`)
  );

  const bench = state.series[BENCH];
  const lasts = Object.values(state.series).filter((s) => s.map).map((s) => s.last);
  state.endK = bench && bench.map ? bench.last : lasts.length ? Math.max(...lasts) : null;

  for (const h of state.holdings) {
    if (h.isCash) { h.status = "cash"; continue; }
    const s = loaded[h.symbol];
    if (s && s.map) {
      h.status = "ok";
      if (h.value == null && h.shares != null) h.value = h.shares * s.lastPrice;
      if (h.gain == null && h.cost != null && h.value != null) h.gain = h.value - h.cost;
    } else {
      h.status = "nodata";
      h.error = s ? s.error : "No price history";
    }
  }
  $("progress").textContent = "";
  renderHoldings();
  renderSectors();

  const missing = state.holdings.filter((h) => h.status === "nodata");
  const limited = missing.filter((h) => loaded[h.symbol] && loaded[h.symbol].rateLimited);
  const other = missing.filter((h) => !limited.includes(h));
  const unadj = state.holdings.filter((h) => h.status === "ok" && !state.series[h.symbol].adjusted);
  let msg = "";
  if (limited.length) msg += `<div class="warnbox">The free data plans' limits were reached before ${limited.map((m) => esc(m.symbol)).join(", ")} loaded, so ${limited.length === 1 ? "it is" : "they are"} left out for now. Load the file again in a few minutes; holdings already loaded are saved for 24 hours and won't count again.</div>`;
  if (other.length) msg += `<div class="warnbox">No price history for ${other.map((m) => esc(m.symbol)).join(", ")}, so ${other.length === 1 ? "it is" : "they are"} left out of the analysis.</div>`;
  if (unadj.length) msg += `<div class="warnbox">Price history for ${unadj.map((m) => esc(m.symbol)).join(", ")} came from Twelve Data without dividends, so ${unadj.length === 1 ? "its returns are" : "their returns are"} understated.</div>`;
  $("loadMsg").innerHTML = msg;
  if (!state.endK) {
    $("loadMsg").innerHTML += `<div class="error">No price history could be loaded, so there's nothing to analyze yet.</div>`;
    return;
  }
  fillSellSelect();
  $("swap").hidden = false;
}

function included() {
  return state.holdings.filter((h) => (h.status === "ok" || h.status === "cash") && h.value > 0);
}

function renderHoldings() {
  const inc = included();
  const total = inc.reduce((a, h) => a + h.value, 0);
  const all = state.holdings.reduce((a, h) => a + (h.value || 0), 0);
  const gain = state.holdings.reduce((a, h) => a + (h.gain || 0), 0);
  $("summary").innerHTML = `
    <div><b>${usd(all)}</b>Total value</div>
    <div><b>${state.holdings.length}</b>Holdings</div>
    <div><b class="${cls(gain)}">${usd(gain)}</b>Unrealized gain</div>`;

  const sorted = [...state.holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
  const sel = state.analysis && state.analysis.x.symbol;
  $("rows").innerHTML = sorted.map((h) => {
    const s = state.series[h.symbol];
    let r5 = null;
    if (s && s.map && state.endK) {
      const a = s.map.get(state.endK - 60), b = s.map.get(state.endK);
      if (a && b) r5 = b / a - 1;
    }
    const tag = h.isCash ? `<span class="tag">Cash</span>`
      : h.status === "ok" ? `<span class="tag">Since ${keyLabel(s.first)}</span>${s.adjusted ? "" : ` <span class="tag warn" title="Twelve Data history without dividends">No dividends</span>`}`
      : h.status === "nodata" ? `<span class="tag warn" title="${esc(h.error)}">No data</span>`
      : `<span class="tag">Loading</span>`;
    return `<tr class="${h.symbol === sel ? "selected" : ""}">
      <td><span class="tick">${esc(h.symbol)}</span>${h.name ? `<span class="name">${esc(h.name)}</span>` : ""}</td>
      <td class="num">${h.shares == null ? "—" : h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
      <td class="num">${usd(h.value)}</td>
      <td class="num">${h.value != null && all ? pct(h.value / all, 1, false) : "—"}</td>
      <td class="num ${cls(h.gain)}">${h.gain == null ? "—" : usd(h.gain)}</td>
      <td class="num ${cls(r5)}">${pct(r5, 0)}</td>
      <td>${tag}</td>
    </tr>`;
  }).join("");
}

function fillSellSelect() {
  const opts = included().filter((h) => !h.isCash).sort((a, b) => b.value - a.value);
  $("sellSel").innerHTML = opts.map((h) => `<option value="${esc(h.symbol)}">${esc(h.symbol)} (${usd(h.value)})</option>`).join("");
}

// ---------------------------------------------------------------- analysis

function stats(rets) {
  let v = 10000, peak = 10000, mdd = 0;
  const path = [v];
  for (const r of rets) { v *= 1 + r; path.push(v); peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { path, end: v, total: v / 10000 - 1, cagr: Math.pow(v / 10000, 12 / n) - 1, vol: sd * Math.sqrt(12), mdd };
}

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

// Monthly return of everything except the position being sold, weighted by
// today's values. Holdings without data in a given month are skipped and the
// remaining weights are rescaled; cash earns 0.
function restReturn(rest, k) {
  let w = 0, r = 0;
  for (const h of rest) {
    const x = h.isCash ? 0 : ret(state.series[h.symbol], k);
    if (x == null) continue;
    w += h.value; r += h.value * x;
  }
  return w ? r / w : 0;
}

function analyze(xSym, ySym) {
  const inc = included();
  const x = inc.find((h) => h.symbol === xSym);
  const rest = inc.filter((h) => h !== x);
  const total = inc.reduce((a, h) => a + h.value, 0);
  const wX = x.value / total;
  const sx = state.series[x.symbol], sy = state.series[ySym], sb = state.series[BENCH];
  const endK = state.endK;
  const firstK = Math.max(sx.first, sy.first) + 1; // first month with a return for both

  // Joint monthly returns for every month both X and Y have data.
  const months = [];
  for (let k = firstK; k <= endK; k++) {
    const rx = ret(sx, k), ry = ret(sy, k);
    if (rx == null || ry == null) continue;
    const rr = restReturn(rest, k);
    months.push({ k, rx, ry, rr, cur: wX * rx + (1 - wX) * rr, swp: wX * ry + (1 - wX) * rr, rb: ret(sb, k) });
  }

  const gain = x.gain != null ? x.gain : x.cost != null ? x.value - x.cost : null;
  return { x, ySym, wX, total, months, gain, firstK, endK, rest };
}

function inWindow(a, years) {
  const startK = a.endK - years * 12;
  return a.months.filter((m) => m.k > startK);
}

// Small seeded RNG so the projection doesn't jump around between clicks.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resample historical months (the same month for both versions, so they face
// identical markets) to build a range of possible paths.
function project(a, years, taxRate) {
  const sample = a.months.slice(-120);
  const H = years * 12;
  const tax = Math.max(0, a.gain || 0) * taxRate;
  const v0c = a.total, v0s = a.total - tax;
  const c = new Float64Array(SIMS).fill(v0c), s = new Float64Array(SIMS).fill(v0s);
  const rand = rng(500);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const bands = { cur: [[v0c, v0c, v0c]], swp: [[v0s, v0s, v0s]] };
  for (let m = 1; m <= H; m++) {
    for (let i = 0; i < SIMS; i++) {
      const mo = sample[Math.floor(rand() * sample.length)];
      c[i] *= 1 + mo.cur; s[i] *= 1 + mo.swp;
    }
    const sc = Float64Array.from(c).sort(), ss = Float64Array.from(s).sort();
    bands.cur.push([q(sc, 0.1), q(sc, 0.5), q(sc, 0.9)]);
    bands.swp.push([q(ss, 0.1), q(ss, 0.5), q(ss, 0.9)]);
  }
  let ahead = 0;
  for (let i = 0; i < SIMS; i++) if (s[i] > c[i]) ahead++;
  return { tax, v0c, v0s, bands, ahead: ahead / SIMS, sampleMonths: sample.length, sampleFrom: sample[0].k };
}

// ---------------------------------------------------------------- render

function lineChart(id, labels, datasets, yFmt) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart($(id), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => !i.dataset.bandEdge,
          callbacks: { label: (c) => `${c.dataset.label}: ${yFmt(c.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 7, color: "#52606D", font: { family: "Instrument Sans" } } },
        y: { grid: { color: "#E6EBF0" }, border: { display: false }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => yFmt(v) } },
      },
    },
  });
}

const line = (label, data, color, opts = {}) => ({
  label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
  pointRadius: 0, pointHoverRadius: 4, tension: 0.15, ...opts,
});

const legend = (items) => items.map(([label, color, dash]) =>
  `<span><span class="swatch ${dash ? "dash" : ""}" style="background:${color}"></span>${esc(label)}</span>`).join("");

function renderBacktest() {
  const a = state.analysis;
  const want = state.period;
  const ms = inWindow(a, want);
  const xs = a.x.symbol, ys = a.ySym;
  if (ms.length < 6) {
    $("backTable").innerHTML = "";
    $("periodNote").textContent = `Not enough shared history for ${xs} and ${ys} to backtest this period.`;
    return;
  }
  const actualYears = ms.length / 12;
  $("periodNote").textContent = actualYears < want - 0.1
    ? `${state.series[xs].first >= state.series[ys].first ? xs : ys} has only traded since ${keyLabel(a.firstK - 1)}, so this covers ${actualYears.toFixed(1)} years.`
    : `${keyLabel(ms[0].k - 1)} to ${keyLabel(ms[ms.length - 1].k)}`;

  const cur = stats(ms.map((m) => m.cur));
  const swp = stats(ms.map((m) => m.swp));
  const hasB = ms.every((m) => m.rb != null);
  const ben = hasB ? stats(ms.map((m) => m.rb)) : null;
  const sx = stats(ms.map((m) => m.rx));
  const sy = stats(ms.map((m) => m.ry));
  const rr = ms.map((m) => m.rr);
  const cx = corr(ms.map((m) => m.rx), rr), cy = corr(ms.map((m) => m.ry), rr);

  const better = swp.cagr > cur.cagr;
  const span = actualYears < want - 0.1 ? `${actualYears.toFixed(1)} years` : `${want} year${want > 1 ? "s" : ""}`;
  $("headline").textContent = `Over the last ${span}, owning ${ys} instead of ${xs} would have ${better ? "raised" : "lowered"} the portfolio's annual return from ${pct(cur.cagr, 1, false)} to ${pct(swp.cagr, 1, false)}.`;

  const cols = [
    ["Portfolio as is", cur],
    [`With ${ys} instead of ${xs}`, swp],
    ...(ben ? [["S&P 500 (SPY)", ben]] : []),
    [`${xs} alone`, sx],
    [`${ys} alone`, sy],
  ];
  const row = (label, f, fmtCls) => `<tr><td>${label}</td>${cols.map(([, s]) => `<td class="num ${fmtCls ? cls(fmtCls(s)) : ""}">${f(s)}</td>`).join("")}</tr>`;
  $("backTable").innerHTML = `
    <thead><tr><th></th>${cols.map(([h]) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("$10,000 became", (s) => usd(s.end))}
      ${row("Total return", (s) => pct(s.total), (s) => s.total)}
      ${row("Annual return", (s) => pct(s.cagr), (s) => s.cagr)}
      ${row("Volatility (annual)", (s) => pct(s.vol, 1, false))}
      ${row("Worst drop", (s) => pct(s.mdd), (s) => s.mdd)}
      <tr><td>Correlation with the rest of the portfolio</td>${cols.map(([h]) =>
        `<td class="num">${h === `${xs} alone` ? cx.toFixed(2) : h === `${ys} alone` ? cy.toFixed(2) : ""}</td>`).join("")}</tr>
    </tbody>`;

  const labels = [keyLabel(ms[0].k - 1), ...ms.map((m) => keyLabel(m.k))];
  const ds = [
    line("Portfolio as is", cur.path, C.cur),
    line(`With ${ys}`, swp.path, C.swap),
  ];
  if (ben) ds.push(line("S&P 500 (SPY)", ben.path, C.bench, { borderWidth: 1.5, borderDash: [5, 4] }));
  lineChart("backChart", labels, ds, (v) => usd(v));
  $("backLegend").innerHTML = legend([["Portfolio as is", C.cur], [`With ${ys} instead of ${xs}`, C.swap], ...(ben ? [["S&P 500 (SPY)", C.bench, true]] : [])]);
}

function renderTax() {
  const a = state.analysis;
  const rate = taxRate();
  const xs = a.x.symbol;
  let html;
  if (a.gain == null) {
    html = `No cost basis for ${esc(xs)}, so tax isn't included. Add the cost basis to estimate it.`;
  } else if (a.gain <= 0) {
    html = `Selling all ${usd(a.x.value)} of ${esc(xs)} realizes a <b>loss of ${usd(-a.gain)}</b>, which could offset other gains. No tax is deducted from the amount reinvested.`;
  } else {
    const tax = a.gain * rate;
    html = `Selling all ${usd(a.x.value)} of ${esc(xs)} realizes a <b>${usd(a.gain)} gain</b>. At ${(rate * 100).toFixed(1)}%, that's about <b>${usd(tax)} in tax</b>, leaving ${usd(a.x.value - tax)} to buy ${esc(a.ySym)}. The projection below starts the replacement portfolio ${usd(tax)} behind.`;
  }
  html += ` ${esc(xs)} is ${pct(a.wX, 1, false)} of the portfolio${a.wX > 0.2 ? ", so this swap changes the portfolio a lot" : ""}.`;
  $("taxLine").innerHTML = html;
}

function renderProjection() {
  const a = state.analysis;
  if (a.months.length < 24) {
    $("projNote").textContent = `${a.ySym} and ${a.x.symbol} need at least two years of shared history to project.`;
    $("projTable").innerHTML = "";
    if (state.charts.projChart) { state.charts.projChart.destroy(); delete state.charts.projChart; }
    $("projLegend").innerHTML = "";
    return;
  }
  const y = state.horizon;
  const p = project(a, y, taxRate());
  const yrs = (p.sampleMonths / 12).toFixed(p.sampleMonths % 12 ? 1 : 0);
  $("projNote").textContent = `A range of outcomes built by replaying ${SIMS.toLocaleString()} random sequences of this portfolio's actual monthly returns from the last ${yrs} years (since ${keyLabel(p.sampleFrom - 1)}). Both versions face the same months each time, so the difference comes only from the swap and the tax. The past may not repeat.`;

  const end = (b) => b[b.length - 1];
  const ec = end(p.bands.cur), es = end(p.bands.swp);
  const r = (label, i) => `<tr><td>${label}</td><td class="num">${usd(ec[i])}</td><td class="num">${usd(es[i])}</td><td class="num ${cls(es[i] - ec[i])}">${es[i] - ec[i] >= 0 ? "+" : ""}${usd(es[i] - ec[i])}</td></tr>`;
  $("projTable").innerHTML = `
    <thead><tr><th>In ${y} year${y > 1 ? "s" : ""}</th><th class="num">Portfolio as is</th><th class="num">With ${esc(a.ySym)}</th><th class="num">Difference</th></tr></thead>
    <tbody>
      <tr><td>Starting value (after tax)</td><td class="num">${usd(p.v0c)}</td><td class="num">${usd(p.v0s)}</td><td class="num ${p.v0s < p.v0c ? "down" : ""}">${p.v0s === p.v0c ? "—" : usd(p.v0s - p.v0c)}</td></tr>
      ${r("Weak outcome (1 in 10 do worse)", 0)}
      ${r("Middle outcome", 1)}
      ${r("Strong outcome (1 in 10 do better)", 2)}
      <tr><td colspan="4"><b>${Math.round(p.ahead * 100)}%</b> of simulations end with the ${esc(a.ySym)} version ahead${p.tax > 0 ? ", after paying the tax" : ""}.</td></tr>
    </tbody>`;

  const labels = Array.from({ length: y * 12 + 1 }, (_, m) => (m % 12 === 0 ? `Year ${m / 12}` : `Month ${m}`));
  const col = (b, i) => b.map((v) => v[i]);
  const ds = [
    line("Portfolio as is, strong", col(p.bands.cur, 2), "transparent", { bandEdge: true, borderWidth: 0, pointHoverRadius: 0, fill: "+1", backgroundColor: BAND.cur }),
    line("Portfolio as is, weak", col(p.bands.cur, 0), "transparent", { bandEdge: true, borderWidth: 0, pointHoverRadius: 0 }),
    line(`With ${a.ySym}, strong`, col(p.bands.swp, 2), "transparent", { bandEdge: true, borderWidth: 0, pointHoverRadius: 0, fill: "+1", backgroundColor: BAND.swp }),
    line(`With ${a.ySym}, weak`, col(p.bands.swp, 0), "transparent", { bandEdge: true, borderWidth: 0, pointHoverRadius: 0 }),
    line("Portfolio as is, middle", col(p.bands.cur, 1), C.cur),
    line(`With ${a.ySym}, middle`, col(p.bands.swp, 1), C.swap),
  ];
  lineChart("projChart", labels, ds, (v) => usd(v));
  state.charts.projChart.options.scales.x.ticks.callback = function (v, i) { return i % 12 === 0 ? this.getLabelForValue(v) : ""; };
  state.charts.projChart.options.scales.x.ticks.maxTicksLimit = undefined;
  state.charts.projChart.options.scales.x.ticks.autoSkip = false;
  state.charts.projChart.options.scales.x.ticks.maxRotation = 0;
  state.charts.projChart.update();
  $("projLegend").innerHTML = legend([["Portfolio as is, middle outcome", C.cur], [`With ${a.ySym}, middle outcome`, C.swap]]) +
    `<span>Shaded: weak to strong outcomes</span>`;
}

function taxRate() {
  const v = parseFloat($("taxIn").value);
  return isFinite(v) && v > 0 ? Math.min(v, 100) / 100 : 0;
}

function renderResults() {
  renderTax();
  renderBacktest();
  renderProjection();
  renderHoldings();
}

// ---------------------------------------------------------------- wiring

async function runSwap() {
  const xSym = $("sellSel").value;
  const ySym = cleanSym($("buyIn").value);
  $("swapMsg").innerHTML = "";
  if (!xSym) return;
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ySym)) { $("swapMsg").innerHTML = `<div class="error">Enter the ticker to buy instead.</div>`; return; }
  if (ySym === xSym) { $("swapMsg").innerHTML = `<div class="error">Choose a different stock to buy than the one you're selling.</div>`; return; }
  $("runBtn").disabled = true;
  $("runBtn").textContent = "Loading…";
  const s = await fetchSeries(ySym);
  $("runBtn").disabled = false;
  $("runBtn").textContent = "Compare";
  if (!s || !s.map) {
    const limited = s && s.rateLimited;
    $("swapMsg").innerHTML = `<div class="error">${limited
      ? "The free data plans' request limits have been reached. Try again in a minute."
      : `Couldn't find price history for ${esc(ySym)}. Check the ticker.`}</div>`;
    return;
  }
  state.analysis = analyze(xSym, ySym);
  if (state.analysis.months.length < 6) {
    $("swapMsg").innerHTML = `<div class="error">${esc(xSym)} and ${esc(ySym)} have less than six months of history in common, so there's nothing to compare yet.</div>`;
    $("results").hidden = true;
    return;
  }
  $("results").hidden = false;
  renderResults();
  $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function seg(id, key, render) {
  $(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    state[key] = Number(b.dataset.y);
    $(id).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (state.analysis) render();
  }));
}

function readFile(file) {
  if (!file) return;
  $("fileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) importPortfolios(text);
      else loadHoldings(holdingsFromCSV(text), `From ${file.name}`);
    } catch (e) {
      $("loadMsg").innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };
  reader.readAsText(file);
}

const drop = $("drop");
drop.addEventListener("click", () => $("file").click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer.files[0]); });
$("file").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
$("manualBtn").addEventListener("click", () => {
  try {
    loadHoldings(holdingsFromText($("manual").value), "Entered by hand");
  } catch (e) {
    $("loadMsg").innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
});
$("runBtn").addEventListener("click", runSwap);
$("progress").addEventListener("click", (e) => { if (e.target.id === "stopWait") state.stopWaiting = true; });
$("buyIn").addEventListener("keydown", (e) => { if (e.key === "Enter") runSwap(); });
$("taxIn").addEventListener("change", () => { if (state.analysis) { renderTax(); renderProjection(); } });
seg("periodSeg", "period", renderBacktest);
seg("horizonSeg", "horizon", renderProjection);


// ---------------------------------------------------------------- sector chart

function renderSectors() {
  const hs = state.holdings.filter((h) => h.value > 0);
  const total = hs.reduce((a, h) => a + h.value, 0);
  if (!total) { $("sectorBlock").hidden = true; return; }
  const agg = {};
  for (const h of hs) {
    const sec = sectorFor(h);
    (agg[sec] ||= { value: 0, syms: [] }).value += h.value;
    agg[sec].syms.push(h.symbol);
  }
  const rows = Object.entries(agg).map(([sector, v]) => ({ sector, ...v, w: v.value / total })).sort((a, b) => b.value - a.value);
  $("sectorBlock").hidden = false;
  $("sectorBox").style.height = rows.length * 32 + 36 + "px";

  // Percent labels at the end of each bar, so the chart reads without hovering.
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = "500 12px 'Instrument Sans', system-ui, sans-serif";
      ctx.fillStyle = "#52606D";
      ctx.textBaseline = "middle";
      meta.data.forEach((bar, i) => ctx.fillText(rows[i].w < 0.0005 ? "<0.1%" : pct(rows[i].w, 1, false), bar.x + 6, bar.y));
      ctx.restore();
    },
  };

  if (state.charts.sectorChart) state.charts.sectorChart.destroy();
  state.charts.sectorChart = new Chart($("sectorChart"), {
    type: "bar",
    data: {
      labels: rows.map((r) => r.sector),
      datasets: [{ data: rows.map((r) => r.w * 100), backgroundColor: C.cur, hoverBackgroundColor: "#2F6696", borderRadius: 4, borderSkipped: "start", barThickness: 16 }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 48 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${usd(rows[c.dataIndex].value)} (${pct(rows[c.dataIndex].w, 1, false)})`,
            afterLabel: (c) => {
              const s = rows[c.dataIndex].syms;
              return s.length > 10 ? s.slice(0, 10).join(", ") + ` and ${s.length - 10} more` : s.join(", ");
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#E6EBF0" }, border: { display: false }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => v + "%" } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: "#102A43", font: { family: "Instrument Sans", size: 13 } } },
      },
    },
    plugins: [endLabels],
  });

  $("sectorTable").innerHTML = `<thead><tr><th>Sector</th><th class="num">Value</th><th class="num">Weight</th><th>Holdings</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.sector)}</td><td class="num">${usd(r.value)}</td><td class="num">${pct(r.w, 1, false)}</td><td>${esc(r.syms.join(", "))}</td></tr>`).join("")
  }</tbody>`;
}

// ---------------------------------------------------------------- saved portfolios
// Kept in this browser's localStorage. Nothing is sent to a server. To move
// portfolios to another computer, export them to a file and open it there.

const STORE_KEY = "pb500.portfolios.v1";
const FILE_TAG = "portfolio-builder-500";

function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function writeSaved(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
  catch { return false; }
}

// Stores shares and cost basis, not today's value, so reopening a saved
// portfolio values it at the latest prices.
function snapshot() {
  return state.holdings.map((h) => ({
    symbol: h.symbol,
    name: h.name || "",
    shares: h.shares ?? null,
    value: h.isCash || h.shares == null ? h.value ?? null : null,
    cost: h.cost != null ? h.cost : h.gain != null && h.value != null ? h.value - h.gain : null,
    isCash: !!h.isCash,
  }));
}

const finiteOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function cleanPortfolio(p) {
  if (!p || typeof p.name !== "string" || !Array.isArray(p.holdings)) return null;
  const holdings = p.holdings
    .filter((h) => h && typeof h.symbol === "string" && /^[A-Z0-9.\-]{1,12}$/i.test(h.symbol))
    .map((h) => ({
      symbol: cleanSym(h.symbol), name: typeof h.name === "string" ? h.name.slice(0, 120) : "",
      shares: finiteOrNull(h.shares), value: finiteOrNull(h.value), cost: finiteOrNull(h.cost), isCash: !!h.isCash,
    }))
    .filter((h) => h.shares != null || h.value != null);
  if (!holdings.length) return null;
  return {
    id: typeof p.id === "string" ? p.id : String(Date.now() + Math.random()),
    name: p.name.trim().slice(0, 80) || "Untitled",
    savedAt: typeof p.savedAt === "string" && !isNaN(Date.parse(p.savedAt)) ? p.savedAt : new Date().toISOString(),
    holdings,
  };
}

function saveCurrent() {
  const name = $("saveName").value.trim();
  if (!state.holdings.length) return;
  if (!name) { $("saveMsg").textContent = "Give the portfolio a name first."; $("saveName").focus(); return; }
  const list = readSaved();
  const existing = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const entry = { id: existing ? existing.id : String(Date.now()), name, savedAt: new Date().toISOString(), holdings: snapshot() };
  const next = existing ? list.map((p) => (p === existing ? entry : p)) : [entry, ...list];
  if (!writeSaved(next)) {
    $("saveMsg").textContent = "This browser isn't allowing saved data (it may be in private mode). Use Export instead.";
    return;
  }
  $("saveMsg").textContent = existing ? `Updated "${name}".` : `Saved "${name}" on this computer.`;
  renderSaved();
}

function openSaved(id) {
  const p = readSaved().find((x) => x.id === id);
  if (!p) return;
  const holdings = p.holdings.map((h) => ({ ...h, gain: null }));
  const when = new Date(p.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  loadHoldings(holdings, `Saved ${when}, valued at the latest prices`, p.name);
  $("holdings").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function deleteSaved(id) {
  writeSaved(readSaved().filter((p) => p.id !== id));
  renderSaved();
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "portfolio";
}

function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPortfolios(list, filename) {
  download(filename, { app: FILE_TAG, version: 1, exportedAt: new Date().toISOString(), portfolios: list });
}

function importPortfolios(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("This file isn't a portfolio file from this page."); }
  const incoming = (Array.isArray(data.portfolios) ? data.portfolios : [data]).map(cleanPortfolio).filter(Boolean);
  if (!incoming.length) throw new Error("No portfolios found in this file.");
  const list = readSaved();
  let added = 0, updated = 0;
  for (const p of incoming) {
    const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (i < 0) { list.unshift(p); added++; }
    else if (Date.parse(p.savedAt) >= Date.parse(list[i].savedAt)) { list[i] = { ...p, id: list[i].id }; updated++; }
  }
  const ok = writeSaved(list);
  renderSaved();
  if (incoming.length === 1) {
    const p = ok ? readSaved().find((x) => x.name.toLowerCase() === incoming[0].name.toLowerCase()) : incoming[0];
    if (ok) openSaved(p.id);
    else loadHoldings(p.holdings.map((h) => ({ ...h, gain: null })), "Opened from file", p.name);
  } else {
    $("loadMsg").innerHTML = ok
      ? `<div class="warnbox">Added ${added} and updated ${updated} saved portfolio${added + updated === 1 ? "" : "s"}${incoming.length - added - updated ? `; ${incoming.length - added - updated} older cop${incoming.length - added - updated === 1 ? "y was" : "ies were"} skipped` : ""}. Open one from the list.</div>`
      : `<div class="error">This browser isn't allowing saved data, so the portfolios couldn't be added.</div>`;
  }
}

function renderSaved() {
  const list = readSaved();
  $("exportAll").hidden = !list.length;
  if (!list.length) {
    $("savedList").innerHTML = `<li class="note">No saved portfolios yet. Load one, give it a name, and click Save portfolio.</li>`;
    return;
  }
  $("savedList").innerHTML = list.map((p) => {
    const when = new Date(p.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<li data-id="${esc(p.id)}">
      <span class="pname">${esc(p.name)}<span class="pmeta">${p.holdings.length} holdings, saved ${when}</span></span>
      <span class="actions">
        <button class="ghost" type="button" data-act="open">Open</button>
        <button class="ghost" type="button" data-act="export">Export</button>
        <button class="ghost danger" type="button" data-act="delete">Delete</button>
      </span>
    </li>`;
  }).join("");
}

$("savedList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const id = b.closest("li").dataset.id;
  const p = readSaved().find((x) => x.id === id);
  if (!p) return;
  if (b.dataset.act === "open") openSaved(id);
  else if (b.dataset.act === "export") exportPortfolios([p], `${slug(p.name)}.portfolio.json`);
  else if (b.dataset.act === "delete") {
    if (b.dataset.confirm) deleteSaved(id);
    else { b.dataset.confirm = "1"; b.textContent = "Confirm delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = "Delete"; } }, 4000); }
  }
});
$("exportAll").addEventListener("click", () => {
  const list = readSaved();
  if (list.length) exportPortfolios(list, `portfolios-${new Date().toISOString().slice(0, 10)}.json`);
});
$("saveBtn").addEventListener("click", saveCurrent);
$("saveName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveCurrent(); });
renderSaved();
