// Portfolio Builder 500 — front-end logic
const START = 10000;
const DROP_COUNT = 2;
const BENCH = "SPY";
const REFRESH_MS = 5 * 60_000; // prices are cached for 5 minutes on the server
const COLORS = { strategy: "#B7791F", all: "#52606D", bench: "#102A43" };

const state = { years: 10, portfolio: null, history: null, historyKey: "", chart: null, pie: null, mixView: "start" };
// One fixed color per sector, so a sector keeps its color in every view.
// Ordered so neighbors in the standard sector order stay distinct (checked for
// color-blind separation); slices are also labeled, so color is never the only cue.
const SECTOR_COLORS = {
  "Information Technology": "#2a78d6",
  "Communication Services": "#eb6834",
  "Consumer Discretionary": "#1baf7a",
  "Financials": "#eda100",
  "Health Care": "#e87ba4",
  "Consumer Staples": "#008300",
  "Energy": "#4a3aa7",
  "Industrials": "#e34948",
  "Materials": "#13a3c6",
  "Utilities": "#9a6b00",
  "Real Estate": "#b45fb0",
};
// Dark or white text, whichever reads better on a slice color.
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#102A43" : "#FFFFFF";
}

const $ = (id) => document.getElementById(id);
const fmtUSD = (v, d = 0) => v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d });
const fmtPct = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const fmtCap = (v) => !v ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : "$" + (v / 1e9).toFixed(0) + "B";
const cls = (v) => v == null ? "" : v >= 0 ? "up" : "down";
const monthKey = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const keyLabel = (k) => new Date(Date.UTC(Math.floor(k / 12), k % 12, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

async function getJSON(url) {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok || (data && data.error)) {
    throw new Error((data && data.message) || `${url} returned ${r.status}`);
  }
  return data;
}

function setStatus(kind, text) {
  $("dot").className = "dot " + (kind || "");
  $("statusText").textContent = text;
}

// ---------- Data ----------
async function loadPortfolio() {
  const data = await getJSON("/api/portfolio");
  state.portfolio = data;
  setPriceStatus();
  return data;
}

function setPriceStatus() {
  const data = state.portfolio;
  if (!data) return;
  const time = new Date(data.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (data.quotesError) setStatus("warn", `Live prices unavailable right now; backtest unaffected. Checked ${time}`);
  else setStatus("live", `Live from Tiingo, updated ${time}`);
}

function holdingsList() {
  return state.portfolio.sectors.flatMap((s) => s.holdings.map((h) => ({ ...h, sector: s.sector })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_SECONDS = 60;  // Twelve Data's per-minute limit resets every minute
const MAX_WAITS = 8;

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

function toSeries(pts, meta) {
  const m = new Map();
  for (const pt of pts) m.set(monthKey(pt.t), pt.p);
  return { map: m, first: Math.min(...m.keys()), last: Math.max(...m.keys()), chainNote: (meta && meta.chainNote) || null };
}

async function fetchOneHistory(sym) {
  try {
    const r = await fetch("/api/history?symbols=" + encodeURIComponent(sym));
    const d = await r.json().catch(() => null);
    const pts = d && d.series && d.series[sym];
    if (Array.isArray(pts) && pts.length > 1) return { series: toSeries(pts, d.meta && d.meta[sym]) };
    const err = (pts && pts.error) || (d && d.message) || `HTTP ${r.status}`;
    return { error: err, rateLimited: !!((pts && pts.rateLimited) || (d && d.rateLimited) || r.status === 429) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// Loads price history for the 22 stocks plus SPY. Tries one combined request
// first (usually already cached); anything it didn't return is fetched one
// stock at a time, waiting out the data providers' per-minute limits. Only
// successes are kept, so a later refresh retries whatever is still missing.
async function loadHistory() {
  const syms = holdingsList().map((h) => h.symbol).concat(BENCH);
  const key = syms.slice().sort().join(",");
  if (key !== state.historyKey || !state.history) { state.history = {}; state.historyKey = key; }
  const maps = state.history;
  if (state.loadingHistory || syms.every((s) => maps[s])) return maps;
  state.loadingHistory = true;
  const progress = (extra = "") => {
    const n = syms.filter((s) => maps[s]).length;
    if (n < syms.length) setStatus("warn", `Loaded price history for ${n} of ${syms.length}${extra}`);
  };
  try {
    if (syms.every((s) => !maps[s])) {
      try {
        const r = await fetch("/api/history?symbols=" + encodeURIComponent(syms.join(",")));
        const d = await r.json().catch(() => null);
        if (d && d.series) for (const [s, pts] of Object.entries(d.series)) if (Array.isArray(pts) && pts.length > 1) maps[s] = toSeries(pts, d.meta && d.meta[s]);
      } catch { /* fall through to one at a time */ }
      renderAll();
    }
    let need = syms.filter((s) => !maps[s]);
    for (let round = 0; need.length && round <= MAX_WAITS; round++) {
      if (round > 0) {
        for (let sec = WAIT_SECONDS; sec > 0; sec--) { progress(`. The free data plans allow only so many requests a minute; continuing in ${sec}s`); await sleep(1000); }
      }
      const retry = [];
      let limited = false;
      for (const s of need) {
        if (limited) { retry.push(s); continue; }
        const r = await fetchOneHistory(s);
        if (r.series) { maps[s] = r.series; progress(); }
        else if (r.rateLimited) { limited = true; retry.push(s); }
      }
      need = retry;
      renderAll();
    }
  } finally {
    state.loadingHistory = false;
  }
  if (syms.every((s) => maps[s])) setPriceStatus();
  else progress(". The rest will be retried on the next refresh");
  return maps;
}

// ---------- Backtest ----------
function priceAt(series, k) {
  // Last known price at or before month k (carry forward over gaps).
  for (let i = k; i >= series.first; i--) if (series.map.has(i)) return series.map.get(i);
  return null;
}

function valueSeries(positions, startK, endK) {
  // positions: [{series, shares}]
  const out = [];
  for (let k = startK; k <= endK; k++) {
    let v = 0;
    for (const p of positions) v += p.shares * (priceAt(p.series, k) ?? 0);
    out.push(v);
  }
  return out;
}

function stats(values, months) {
  const end = values[values.length - 1];
  let peak = -Infinity, mdd = 0;
  for (const v of values) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const yrs = months / 12;
  return { end, total: end / START - 1, cagr: Math.pow(end / START, 1 / yrs) - 1, mdd };
}

function backtest(years) {
  const H = state.history;
  const bench = H[BENCH];
  const endK = bench ? bench.last : Math.max(...Object.values(H).map((s) => s.last));
  const startK = endK - years * 12;
  const months = endK - startK;

  const rows = holdingsList().map((h) => {
    const s = H[h.symbol];
    if (!s) return { ...h, status: "nodata", ret: null };
    if (s.first > startK) return { ...h, series: s, status: "na", ret: null };
    const p0 = priceAt(s, startK), p1 = priceAt(s, endK);
    return { ...h, series: s, p0, ret: p1 / p0 - 1, status: "held" };
  });

  const eligible = rows.filter((r) => r.status === "held").sort((a, b) => a.ret - b.ret);
  eligible.slice(0, DROP_COUNT).forEach((r) => (r.status = "dropped"));
  const held = eligible.filter((r) => r.status === "held");
  const w = 1 / held.length;
  held.forEach((r) => (r.weight = w));

  const strat = valueSeries(held.map((r) => ({ series: r.series, shares: (START * w) / r.p0 })), startK, endK);
  const all = valueSeries(eligible.map((r) => ({ series: r.series, shares: START / eligible.length / r.p0 })), startK, endK);
  const benchVals = bench ? valueSeries([{ series: bench, shares: START / priceAt(bench, startK) }], startK, endK) : null;

  const labels = [];
  for (let k = startK; k <= endK; k++) labels.push(keyLabel(k));

  return {
    years, labels, rows, held, eligible, startK, endK,
    strategy: { values: strat, ...stats(strat, months) },
    all: { values: all, ...stats(all, months) },
    bench: benchVals ? { values: benchVals, ...stats(benchVals, months) } : null,
    missing: rows.filter((r) => r.status === "na"),
    nodata: rows.filter((r) => r.status === "nodata"),
  };
}

// ---------- Render ----------
function renderHero(bt) {
  const s = bt.strategy;
  const joinAnd = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1);
  const missing = bt.missing.map((m) => `${m.symbol} (${START_NOTES[m.symbol] || "trading since " + keyLabel(m.series.first)})`);
  const nodata = bt.nodata.map((m) => m.symbol);
  const reasons = [];
  if (missing.length) reasons.push(`${joinAnd(missing)} ${missing.length === 1 ? "has" : "have"} no price history that far back`);
  if (nodata.length) reasons.push(`price history for ${joinAnd(nodata)} hasn't loaded`);
  const weightNote = bt.held.length === 20
    ? "Holds 20 stocks at 5% each."
    : `Holds ${bt.held.length} stocks at ${(100 / bt.held.length).toFixed(2)}% each because ${reasons.join(", and ")}.`;
  const warn = nodata.length
    ? `<div class="error" style="background:#FBEFD9;color:#6B4510">${nodata.length} of the 22 stocks are missing price history${state.loadingHistory ? " and are still loading" : " because the free data plans' limits were reached"}, so these results are incomplete. ${state.loadingHistory ? "The page updates as they arrive." : "Press Refresh in a few minutes."}</div>`
    : "";
  const dropped = bt.eligible.filter((r) => r.status === "dropped").map((r) => r.symbol);

  const card = (title, color, x) => `
    <div>
      <h3><span class="swatch" style="background:${color}"></span>${title}</h3>
      <div class="big">${fmtUSD(x.end)}</div>
      <dl>
        <dt>Total return</dt><dd class="${cls(x.total)}">${fmtPct(x.total)}</dd>
        <dt>Annualized</dt><dd class="${cls(x.cagr)}">${fmtPct(x.cagr, 2)}</dd>
        <dt>Worst drop</dt><dd class="down">${fmtPct(x.mdd)}</dd>
      </dl>
    </div>`;

  $("heroBody").innerHTML = `${warn}
    <h2 class="headline">$10,000 invested ${bt.years === 1 ? "a year" : bt.years + " years"} ago is worth <span class="amt">${fmtUSD(s.end)}</span> today</h2>
    <p class="sub">Started ${bt.labels[0]}. ${weightNote} ${joinAnd(dropped)} ${dropped.length === 1 ? "was" : "were"} removed as the weakest performers over the period. Buy-and-hold, dividends reinvested.</p>
    <div class="compare">
      ${card("Portfolio Builder 500", COLORS.strategy, s)}
      ${card(`All ${bt.eligible.length} holdings, equal weight`, COLORS.all, bt.all)}
      ${bt.bench ? card("S&P 500 (SPY)", COLORS.bench, bt.bench) : "<div></div>"}
    </div>`;
}

function renderChart(bt) {
  const ds = (label, data, color, width, dash) => ({
    label, data, borderColor: color, backgroundColor: color, borderWidth: width, borderDash: dash || [],
    pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
  });
  const datasets = [
    ds("Portfolio Builder 500", bt.strategy.values, COLORS.strategy, 2.5),
    ds(`All ${bt.eligible.length}, equal weight`, bt.all.values, COLORS.all, 1.5, [5, 4]),
  ];
  if (bt.bench) datasets.push(ds("S&P 500 (SPY)", bt.bench.values, COLORS.bench, 1.5));

  const cfg = {
    type: "line",
    data: { labels: bt.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", align: "start", labels: { boxWidth: 14, boxHeight: 3, font: { family: "Instrument Sans" }, color: "#52606D" } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtUSD(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: "#52606D", font: { family: "Instrument Sans" } } },
        y: { grid: { color: "#E6EBF0" }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => fmtUSD(v) } },
      },
    },
  };
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("chart"), cfg);
}

function renderTable(bt) {
  $("retHead").textContent = `${state.years}-yr return`;
  const byRow = Object.fromEntries((bt ? bt.rows : []).map((r) => [r.symbol, r]));
  let html = "";
  for (const s of state.portfolio.sectors) {
    s.holdings.forEach((h, i) => {
      const r = byRow[h.symbol] || {};
      const tag = r.status === "held" ? `<span class="tag held">Held, ${(r.weight * 100).toFixed(r.weight === 0.05 ? 0 : 2)}%</span>`
        : r.status === "dropped" ? `<span class="tag dropped">Dropped, bottom 2</span>`
        : r.status === "na" ? `<span class="tag na" title="${START_NOTES[r.symbol] || ""}">Starts ${keyLabel(r.series.first)}</span>`
        : r.status === "nodata" ? `<span class="tag dropped">Data not loaded</span>` : "";
      html += `<tr class="${i === 0 ? "sector-start" : ""} ${r.status === "dropped" ? "is-dropped" : ""}">
        <td class="sector">${i === 0 ? s.sector : ""}</td>
        <td><span class="tick">${h.symbol}</span><span class="name">${h.name || ""}</span>${state.history && state.history[h.symbol] && state.history[h.symbol].chainNote ? `<span class="name">History includes ${state.history[h.symbol].chainNote}</span>` : ""}</td>
        <td class="num">${fmtUSD(h.price, 2)}</td>
        <td class="num ${cls(h.changePct)}">${h.changePct == null ? "—" : fmtPct(h.changePct / 100, 2)}</td>
        <td class="num ${cls(r.ret)}">${fmtPct(r.ret, 0)}</td>
        <td>${tag}</td>
      </tr>`;
    });
  }
  $("rows").innerHTML = html;
}

function renderAll() {
  if (!state.portfolio) return;
  if (!state.history || !state.history[BENCH]) { renderTable(null); return; }
  const bt = backtest(state.years);
  renderHero(bt);
  renderChart(bt);
  renderTable(bt);
  renderMix(bt);
}

// Sector weights of the held stocks: as bought (equal weight), or today after
// each stock's growth since the start of the period.
function renderMix(bt) {
  const bySector = new Map();
  for (const r of bt.held) {
    const v = state.mixView === "today" ? r.weight * priceAt(r.series, bt.endK) / r.p0 : r.weight;
    const e = bySector.get(r.sector) || { sector: r.sector, value: 0, syms: [] };
    e.value += v; e.syms.push(r.symbol);
    bySector.set(r.sector, e);
  }
  const total = [...bySector.values()].reduce((a, e) => a + e.value, 0);
  const rows = [...bySector.values()].map((e) => ({ ...e, w: e.value / total }));
  const order = state.portfolio.sectors.map((s) => s.sector);
  if (state.mixView === "today") rows.sort((a, b) => b.w - a.w);
  else rows.sort((a, b) => order.indexOf(a.sector) - order.indexOf(b.sector));
  const out = state.portfolio.sectors.map((s) => s.sector).filter((s) => !bySector.has(s));
  const dropped = bt.eligible.filter((r) => r.status === "dropped").map((r) => r.symbol);
  const notLoaded = bt.nodata.map((r) => r.symbol);

  $("mixSection").hidden = false;
  $("mixNote").textContent = state.mixView === "start"
    ? `${bt.held.length} stocks at ${(100 / bt.held.length).toFixed(bt.held.length === 20 ? 0 : 2)}% each, ${bt.years === 1 ? "a year" : bt.years + " years"} ago. Sectors that lost a stock to the bottom-two cut (${dropped.join(", ")}) or to a later listing hold less.`
    : `Where the money sits today after ${bt.years === 1 ? "a year" : bt.years + " years"} of buy-and-hold with no rebalancing. Winners grow into bigger slices.`;
  if (notLoaded.length) $("mixNote").textContent += ` Price history for ${notLoaded.join(", ")} hasn't loaded yet, so ${notLoaded.length === 1 ? "it's" : "they're"} not in the chart.`;

  const colors = rows.map((r) => SECTOR_COLORS[r.sector] || "#8A96A3");
  const narrow = () => $("pie").parentElement.clientWidth < 640;
  const outside = {
    id: "outsideLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const arcs = chart.getDatasetMeta(0).data;
      ctx.save();
      if (narrow()) {
        // Small screens: percentages inside the slices; names are in the table below, clockwise from the top.
        ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        arcs.forEach((arc, i) => {
          const a = (arc.startAngle + arc.endAngle) / 2, rr = arc.outerRadius * 0.66;
          ctx.fillStyle = textOn(colors[i]);
          ctx.fillText(`${Math.round(rows[i].w * 100)}%`, arc.x + Math.cos(a) * rr, arc.y + Math.sin(a) * rr);
        });
        ctx.restore();
        return;
      }
      ctx.font = "500 12px 'Instrument Sans', system-ui, sans-serif";
      ctx.strokeStyle = "#9AA5B1";
      ctx.lineWidth = 1;
      arcs.forEach((arc, i) => {
        const a = (arc.startAngle + arc.endAngle) / 2;
        const cx = arc.x, cy = arc.y, r = arc.outerRadius;
        const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
        const x2 = cx + Math.cos(a) * (r + 16), y2 = cy + Math.sin(a) * (r + 16);
        const right = Math.cos(a) >= 0;
        const x3 = x2 + (right ? 10 : -10);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y2); ctx.stroke();
        ctx.fillStyle = "#102A43";
        ctx.textAlign = right ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(`${rows[i].sector} ${(rows[i].w * 100).toFixed(1)}%`, x3 + (right ? 4 : -4), y2);
      });
      ctx.restore();
    },
  };
  if (state.pie) state.pie.destroy();
  state.pie = new Chart($("pie"), {
    type: "doughnut",
    data: { labels: rows.map((r) => r.sector), datasets: [{ data: rows.map((r) => r.w * 100), backgroundColor: colors, borderColor: "#F6F8F7", borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, cutout: 0,
      layout: { padding: narrow() ? 8 : { top: 30, bottom: 30, left: 200, right: 200 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${(rows[c.dataIndex].w * 100).toFixed(1)}%: ${rows[c.dataIndex].syms.join(", ")}` } },
      },
    },
    plugins: [outside],
  });

  $("mixTable").innerHTML = `<tbody>${rows.map((r, i) => `<tr>
      <td><span class="sw" style="background:${colors[i]}"></span>${r.sector}</td>
      <td class="num">${(r.w * 100).toFixed(1)}%</td>
      <td class="tk">${r.syms.join(", ")}</td>
    </tr>`).join("")}${out.map((s) => `<tr><td><span class="sw" style="background:transparent;border:1px solid var(--rule)"></span>${s}</td><td class="num">0%</td><td class="tk">None held this period</td></tr>`).join("")}</tbody>`;
}

function showError(msg) {
  $("heroBody").innerHTML = `<div class="error">${msg}</div>`;
}

// ---------- Wiring ----------
async function refresh(full) {
  try {
    await loadPortfolio();
    renderAll(); // show live prices right away
    await loadHistory();
    renderAll();
  } catch (e) {
    console.error(e);
    setStatus("warn", "Market data unavailable");
    if (!state.history || !Object.keys(state.history).length) showError(`Couldn't load market data: ${e.message}. If this mentions a limit, wait a few minutes and press Refresh.`);
  }
}

document.querySelectorAll(".periods button").forEach((b) =>
  b.addEventListener("click", () => {
    state.years = Number(b.dataset.years);
    document.querySelectorAll(".periods button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderAll();
  })
);
$("refreshBtn").addEventListener("click", () => refresh(false));
$("mixSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  state.mixView = b.dataset.v;
  $("mixSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderAll();
}));

refresh(true);
setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
