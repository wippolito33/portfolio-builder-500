// Shared by the Analyze and Compare pages: formatting, positions-file
// parsing, price-history loading, saved portfolios, and return math.
// Everything runs in the browser; only ticker symbols are sent to /api/history.

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

// Price history shared across the page: symbol -> { map, first, last, ... }
const DATA = { series: {}, stopWaiting: false };

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
  if (DATA.series[sym]) return DATA.series[sym];
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
  return (DATA.series[sym] = {
    map, first: Math.min(...keys), last: Math.max(...keys), lastPrice: pts[pts.length - 1].p,
    source: m.source || "tiingo", adjusted: m.adjusted !== false, chainNote: m.chainNote || null,
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
  DATA.stopWaiting = false;
  for (let round = 0; pending.length && round <= MAX_WAITS; round++) {
    if (round > 0) {
      for (let s = WAIT_SECONDS; s > 0 && !DATA.stopWaiting; s--) { onWait(s, done, symbols.length); await sleep(1000); }
      if (DATA.stopWaiting) break;
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


// ---------------------------------------------------------------- returns and charts

const CHARTS = {};

function stats(rets) {
  let v = 10000, peak = 10000, mdd = 0;
  const path = [v];
  for (const r of rets) { v *= 1 + r; path.push(v); peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { path, end: v, total: v / 10000 - 1, cagr: Math.pow(v / 10000, 12 / n) - 1, vol: sd * Math.sqrt(12), mdd };
}

function lineChart(id, labels, datasets, yFmt) {
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart($(id), {
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

const STORE_KEY = "pb500.portfolios.v1";

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

// Price at month k, or the last known price before it.
function priceAt(s, k) {
  if (!s || !s.map) return null;
  for (let i = k; i >= s.first; i--) if (s.map.has(i)) return s.map.get(i);
  return null;
}

// Monthly returns from startK to endK for a portfolio held at today's dollar
// weights, rebalanced monthly. Holdings without data in a month are skipped
// and the rest reweighted; cash earns 0. Coverage is the share of today's
// value that had price history at the start.
function weightedReturns(holdings, startK, endK) {
  const rets = [];
  for (let k = startK + 1; k <= endK; k++) {
    let w = 0, r = 0;
    for (const h of holdings) {
      const x = h.isCash ? 0 : ret(DATA.series[h.symbol], k);
      if (x == null) continue;
      w += h.value; r += h.value * x;
    }
    rets.push(w ? r / w : 0);
  }
  const total = holdings.reduce((a, h) => a + h.value, 0);
  const covered = holdings.filter((h) => h.isCash || (DATA.series[h.symbol] && DATA.series[h.symbol].first <= startK))
    .reduce((a, h) => a + h.value, 0);
  return { rets, coverage: total ? covered / total : 0 };
}

// Why a stock's price history starts when it does (shown instead of a bare date).
const START_NOTES = {
  CEG: "spun off from Exelon in Feb 2022",
  GEV: "spun off from GE in Apr 2024",
  META: "IPO in May 2012",
  KVUE: "IPO in May 2023",
  VLTO: "spun off from Danaher in Oct 2023",
  SOLV: "spun off from 3M in Apr 2024",
  CRWD: "IPO in Jun 2019",
  PLTR: "listed in Sep 2020",
  UBER: "IPO in May 2019",
  ABNB: "IPO in Dec 2020",
  CBRS: "IPO in 2025",
};

const PERIODS = [1, 3, 5, 10, 20];
const periodLabel = (y) => (y === 1 ? "1 year" : `${y} years`);

// Shares and cost basis (not today's value), so a reopened portfolio is
// valued at the latest prices.
function snapshotHoldings(holdings) {
  return holdings.map((h) => ({
    symbol: h.symbol,
    name: h.name || "",
    shares: h.shares ?? null,
    value: h.isCash || h.shares == null ? h.value ?? null : null,
    cost: h.cost != null ? h.cost : h.gain != null && h.value != null ? h.value - h.gain : null,
    isCash: !!h.isCash,
  }));
}

// The portfolio most recently loaded on the Analyze page, kept only for this
// browser tab (cleared when the tab closes) so the Compare tab can use it.
const LAST_KEY = "pb500.lastLoaded";
function setLastLoaded(name, holdings) {
  try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ name, holdings: snapshotHoldings(holdings), at: new Date().toISOString() })); } catch {}
}
function getLastLoaded() {
  try { const v = JSON.parse(sessionStorage.getItem(LAST_KEY) || "null"); return v && Array.isArray(v.holdings) ? v : null; } catch { return null; }
}
