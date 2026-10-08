// Portfolio Builder 500 — front-end logic
const START = 10000;
const DROP_COUNT = 2;
const BENCH = "SPY";
const REFRESH_MS = 60_000;
const COLORS = { strategy: "#B7791F", all: "#52606D", bench: "#102A43" };

const state = { years: 10, portfolio: null, history: null, historyKey: "", chart: null };

const $ = (id) => document.getElementById(id);
const fmtUSD = (v, d = 0) => v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d });
const fmtPct = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const fmtCap = (v) => !v ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : "$" + (v / 1e9).toFixed(0) + "B";
const cls = (v) => v == null ? "" : v >= 0 ? "up" : "down";
const monthKey = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const keyLabel = (k) => new Date(Date.UTC(Math.floor(k / 12), k % 12, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

function setStatus(kind, text) {
  $("dot").className = "dot " + (kind || "");
  $("statusText").textContent = text;
}

// ---------- Data ----------
async function loadPortfolio() {
  const data = await getJSON("/api/portfolio");
  state.portfolio = data;
  const time = new Date(data.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (data.source === "yahoo-live") setStatus("live", `Live from Yahoo Finance, updated ${time}`);
  else setStatus("warn", `Prices updated ${time}. Market caps unavailable, using saved ranking`);
  return data;
}

function holdingsList() {
  return state.portfolio.sectors.flatMap((s) => s.holdings.map((h) => ({ ...h, sector: s.sector })));
}

async function loadHistory() {
  const syms = holdingsList().map((h) => h.symbol).concat(BENCH);
  const key = syms.slice().sort().join(",");
  if (key === state.historyKey && state.history) return state.history;
  const data = await getJSON("/api/history?symbols=" + encodeURIComponent(syms.join(",")));
  const maps = {};
  for (const [s, pts] of Object.entries(data.series)) {
    if (!Array.isArray(pts)) continue;
    const m = new Map();
    for (const pt of pts) m.set(monthKey(pt.t), pt.p);
    maps[s] = { map: m, first: Math.min(...m.keys()), last: Math.max(...m.keys()) };
  }
  state.history = maps;
  state.historyKey = key;
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
    if (!s || s.first > startK) return { ...h, status: "na", ret: null };
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
    years, labels, rows, held, eligible,
    strategy: { values: strat, ...stats(strat, months) },
    all: { values: all, ...stats(all, months) },
    bench: benchVals ? { values: benchVals, ...stats(benchVals, months) } : null,
    missing: rows.filter((r) => r.status === "na"),
  };
}

// ---------- Render ----------
function renderHero(bt) {
  const s = bt.strategy;
  const joinAnd = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1);
  const missing = bt.missing.map((m) => m.symbol);
  const weightNote = bt.held.length === 20
    ? "Holds 20 stocks at 5% each."
    : `Holds ${bt.held.length} stocks at ${(100 / bt.held.length).toFixed(2)}% each because ${joinAnd(missing)} ${missing.length === 1 ? "wasn't" : "weren't"} public yet.`;
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

  $("heroBody").innerHTML = `
    <h2 class="headline">$10,000 invested ${bt.years} years ago is worth <span class="amt">${fmtUSD(s.end)}</span> today</h2>
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
        : r.status === "na" ? `<span class="tag na">Not public yet</span>` : "";
      html += `<tr class="${i === 0 ? "sector-start" : ""} ${r.status === "dropped" ? "is-dropped" : ""}">
        <td class="sector">${i === 0 ? s.sector : ""}</td>
        <td><span class="tick">${h.symbol}</span><span class="name">${h.name || ""}</span></td>
        <td class="num">${fmtCap(h.marketCap)}</td>
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
  if (!state.history) { renderTable(null); return; }
  const bt = backtest(state.years);
  renderHero(bt);
  renderChart(bt);
  renderTable(bt);
}

function showError(msg) {
  $("heroBody").innerHTML = `<div class="error">${msg}</div>`;
}

// ---------- Wiring ----------
async function refresh(full) {
  try {
    await loadPortfolio();
    renderAll(); // show live prices right away
    if (full || !state.history) { await loadHistory(); renderAll(); }
    else {
      // If market-cap ranking changed the 22, pull new history.
      const before = state.historyKey;
      await loadHistory();
      if (state.historyKey !== before) renderAll();
    }
  } catch (e) {
    console.error(e);
    setStatus("warn", "Market data unavailable");
    if (!state.history) showError("Couldn't reach Yahoo Finance through the site's data function. Check the function logs in Netlify, then press Refresh.");
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

refresh(true);
setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
