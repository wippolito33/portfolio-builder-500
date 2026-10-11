// Am I Diversified? Load holdings (positions file, typed in, or a saved
// portfolio) and show how the money is spread across positions, asset
// classes and sectors. Runs in the browser; files are never uploaded. Only
// ticker symbols are sent to /api/quotes and /api/history, to value holdings
// entered as shares and to backtest the mix against the S&P 500.

const SINGLE_LIMIT = 0.10;  // an individual stock above this is flagged
const TOP5_LIMIT = 0.50;
const SECTOR_LIMIT = 0.30;
const BAR_MAX = 15;

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
  "U.S. stock funds": "#52606D",
  "International stock funds": "#7FB3A0",
  "Bond funds": "#C9B48A",
  "Cash": "#D9E2EC",
  "Other": "#9AA5B1",
};
const ASSET_COLORS = {
  "U.S. stocks": "#102A43",
  "International stocks": "#12805C",
  "Bonds": "#B7791F",
  "Cash": "#9AA5B1",
  "Other": "#D9E2EC",
};

// Companies based outside the U.S. that trade here as ADRs or foreign listings,
// so they count as international stock. Sector is given for ones sectors.js
// doesn't list.
const FOREIGN = {
  TSM: null, ASML: null, SAP: null, ARM: null, SHOP: null, OBSEF: null,
  BABA: "Consumer Discretionary", PDD: "Consumer Discretionary", JD: "Consumer Discretionary",
  TM: "Consumer Discretionary", SONY: "Consumer Discretionary", BIDU: "Communication Services",
  NVO: "Health Care", AZN: "Health Care", NVS: "Health Care", SNY: "Health Care", GSK: "Health Care",
  BP: "Energy", SHEL: "Energy", UL: "Consumer Staples", DEO: "Consumer Staples", BTI: "Consumer Staples",
  HSBC: "Financials", RY: "Financials", TD: "Financials", MUFG: "Financials",
  BHP: "Materials", RIO: "Materials", INFY: "Information Technology",
};

const COLORS = { mine: "#B7791F", equal: "#52606D", bench: "#102A43" };
const state = { holdings: [], source: "", years: 10, a: null };

function sectorOf(h) {
  const s = sectorFor(h);
  if (s === "Other" && FOREIGN[h.symbol]) return FOREIGN[h.symbol];
  return s;
}
function assetOf(h) {
  const s = sectorOf(h);
  if (s === "Cash") return "Cash";
  if (s === "Bond funds") return "Bonds";
  if (s === "International stock funds") return "International stocks";
  if (s === "U.S. stock funds") return "U.S. stocks";
  if (s === "Other") return "Other";
  return h.symbol in FOREIGN ? "International stocks" : "U.S. stocks";
}
const isFund = (h) => /funds$/.test(sectorOf(h));
const isStock = (h) => !h.isCash && !isFund(h) && sectorOf(h) !== "Other";

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#102A43" : "#FFFFFF";
}

// ---------------------------------------------------------------- valuing holdings

async function fetchQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    try {
      const r = await fetch("/api/quotes?symbols=" + encodeURIComponent(symbols.slice(i, i + 40).join(",")));
      const d = await r.json();
      if (d && d.quotes) Object.assign(out, d.quotes);
    } catch { /* fall back to price history below */ }
  }
  return out;
}

// Holdings entered as shares need a price: latest quotes first (one request
// per 40 tickers). Then monthly price history is loaded for every holding and
// SPY for the backtest; anything still unpriced uses its last month-end price.
async function valueHoldings(list) {
  const need = [...new Set(list.filter((h) => h.value == null && h.shares != null && !h.isCash).map((h) => h.symbol))];
  const price = {};
  if (need.length) {
    $("progress").textContent = `Getting prices for ${need.length} ${need.length === 1 ? "holding" : "holdings"}…`;
    const q = await fetchQuotes(need);
    for (const s of need) if (q[s] && q[s].price) price[s] = q[s].price;
  }
  const syms = [...new Set(list.filter((h) => !h.isCash).map((h) => h.symbol).concat(BENCH))];
  $("progress").textContent = `Loading price history: 0 of ${syms.length}`;
  const loaded = await loadAll(
    syms,
    (d, n) => ($("progress").textContent = `Loading price history: ${d} of ${n}`),
    (secs, d, n) => ($("progress").innerHTML = `Loaded ${d} of ${n}. The free data plans allow only so many requests a minute; continuing in ${secs}s. <button type="button" class="ghost" id="stopWait">Use what's loaded</button>`)
  );
  for (const s of need) if (price[s] == null && loaded[s] && loaded[s].map) price[s] = loaded[s].lastPrice;
  for (const h of list) {
    if (h.value == null && h.shares != null && price[h.symbol] != null) h.value = h.shares * price[h.symbol];
    h.priced = h.value != null && h.value > 0;
  }
  $("progress").textContent = "";
  const limited = list.filter((h) => !h.isCash && loaded[h.symbol] && loaded[h.symbol].rateLimited).map((h) => h.symbol);
  return { missing: list.filter((h) => !h.priced && !h.isCash).map((h) => h.symbol), limited };
}

// ---------------------------------------------------------------- analysis

function group(hs, keyFn, total) {
  const m = new Map();
  for (const h of hs) {
    const k = keyFn(h);
    const e = m.get(k) || { key: k, value: 0, syms: [] };
    e.value += h.value; e.syms.push(h.symbol);
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ ...e, w: e.value / total })).sort((a, b) => b.value - a.value);
}

function analyze(holdings) {
  // Combine duplicate tickers (e.g. the same stock in two accounts).
  const bySym = new Map();
  for (const h of holdings.filter((x) => x.priced)) {
    const k = h.isCash ? "CASH" : h.symbol;
    const e = bySym.get(k) || { ...h, symbol: k, value: 0 };
    e.value += h.value;
    bySym.set(k, e);
  }
  const hs = [...bySym.values()].sort((a, b) => b.value - a.value);
  const total = hs.reduce((a, h) => a + h.value, 0);
  hs.forEach((h) => (h.w = h.value / total));
  const stocks = hs.filter(isStock);
  const top5 = hs.slice(0, 5).reduce((a, h) => a + h.w, 0);
  const assets = group(hs, assetOf, total);
  const sectors = group(hs, sectorOf, total);
  const stockSectors = sectors.filter((s) => SECTOR_COLORS[s.key] && !/funds$|^Cash$|^Other$/.test(s.key));
  // Effective number of positions: 1 / sum of squared weights.
  const effective = 1 / hs.reduce((a, h) => a + h.w * h.w, 0);
  return { hs, total, stocks, top5, assets, sectors, stockSectors, effective };
}

function flagsFor(a) {
  const out = [];
  const big = a.stocks.filter((h) => h.w > SINGLE_LIMIT);
  if (big.length) out.push(["warn", `${big.map((h) => `${h.symbol} is ${pct(h.w, 1, false)}`).join(", ")} of the portfolio. A single stock above ${pct(SINGLE_LIMIT, 0, false)} ties a large share of your money to one company.`]);
  else if (a.stocks.length) out.push(["ok", `No individual stock is more than ${pct(SINGLE_LIMIT, 0, false)} of the portfolio.`]);
  if (a.hs.length > 5 && a.top5 > TOP5_LIMIT) out.push(["warn", `Your five largest holdings make up ${pct(a.top5, 0, false)} of the portfolio.`]);
  const heavy = a.stockSectors.filter((s) => s.w > SECTOR_LIMIT);
  if (heavy.length) out.push(["warn", `${heavy.map((s) => `${s.key} is ${pct(s.w, 0, false)}`).join(", ")} of the portfolio through individual stocks.`]);
  else if (a.stockSectors.length) out.push(["ok", `No single sector is more than ${pct(SECTOR_LIMIT, 0, false)} through individual stocks.`]);
  const intl = (a.assets.find((x) => x.key === "International stocks") || { w: 0 }).w;
  const equity = a.assets.filter((x) => /stocks$/.test(x.key)).reduce((s, x) => s + x.w, 0);
  if (equity > 0.2 && intl === 0) out.push(["warn", "There's no international stock exposure; everything in stocks is U.S.-based."]);
  const bonds = (a.assets.find((x) => x.key === "Bonds") || { w: 0 }).w;
  const cash = (a.assets.find((x) => x.key === "Cash") || { w: 0 }).w;
  if (cash > 0.2) out.push(["warn", `${pct(cash, 0, false)} is in cash.`]);
  if (bonds === 0 && cash < 0.05) out.push(["warn", "There are no bonds and little or no cash to cushion a stock market decline."]);
  return out;
}

// ---------------------------------------------------------------- render

// ---------------------------------------------------------------- growth of $10,000

// Today's holdings at today's dollar weights, rebalanced monthly (the same
// engine as the Analyze and Compare tabs), against SPY and against the same
// holdings at equal weight.
function backtest(a, years) {
  const bench = DATA.series[BENCH];
  const endK = bench.last;
  const startK = Math.max(endK - years * 12, bench.first);
  const mine = weightedReturns(a.hs, startK, endK);
  const equal = weightedReturns(a.hs.map((h) => ({ ...h, value: 1 })), startK, endK);
  const benchRets = [], labels = [keyLabel(startK)];
  for (let k = startK + 1; k <= endK; k++) { benchRets.push(ret(bench, k) ?? 0); labels.push(keyLabel(k)); }
  const late = a.hs.filter((h) => !h.isCash && !(DATA.series[h.symbol] && DATA.series[h.symbol].first <= startK));
  return {
    years, startK, endK, labels, coverage: mine.coverage, late,
    mine: stats(mine.rets), equal: stats(equal.rets), bench: stats(benchRets),
  };
}

function renderGrowth(a) {
  const bt = backtest(a, state.years);
  const card = (title, color, x, dash) => `
    <div>
      <h3><span class="swatch" style="background:${color}${dash ? ";opacity:.75" : ""}"></span>${esc(title)}</h3>
      <div class="big">${usd(x.end)}</div>
      <dl>
        <dt>Total return</dt><dd class="${cls(x.total)}">${pct(x.total)}</dd>
        <dt>Annualized</dt><dd class="${cls(x.cagr)}">${pct(x.cagr, 2)}</dd>
        <dt>Worst drop</dt><dd class="down">${pct(x.mdd)}</dd>
      </dl>
    </div>`;
  const yrs = Math.round((bt.endK - bt.startK) / 12);
  $("heroBody").innerHTML = `
    <h2 class="headline">$10,000 invested ${yrs === 1 ? "a year" : yrs + " years"} ago in this mix is worth <span class="amt">${usd(bt.mine.end)}</span> today</h2>
    <p class="sub">${esc(state.source)}. Started ${keyLabel(bt.startK)} with today's ${a.hs.length} holdings at today's weights, rebalanced monthly. Dividends reinvested.</p>
    <div class="compare">
      ${card("Your portfolio", COLORS.mine, bt.mine)}
      ${card(`Same ${a.hs.length} holdings, equal weight`, COLORS.equal, bt.equal, true)}
      ${card("S&P 500 (SPY)", COLORS.bench, bt.bench)}
    </div>`;

  const ds = (label, data, color, width, dash) => ({
    label, data, borderColor: color, backgroundColor: color, borderWidth: width, borderDash: dash || [],
    pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
  });
  if (CHARTS.chart) CHARTS.chart.destroy();
  CHARTS.chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels: bt.labels,
      datasets: [
        ds("Your portfolio", bt.mine.path, COLORS.mine, 2.5),
        ds(`Same ${a.hs.length}, equal weight`, bt.equal.path, COLORS.equal, 1.5, [5, 4]),
        ds("S&P 500 (SPY)", bt.bench.path, COLORS.bench, 1.5),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", align: "start", labels: { boxWidth: 14, boxHeight: 3, font: { family: "Instrument Sans" }, color: "#52606D" } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: "#52606D", font: { family: "Instrument Sans" } } },
        y: { grid: { color: "#E6EBF0" }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => usd(v) } },
      },
    },
  });
  const notes = [];
  if (yrs < state.years) notes.push(`S&P 500 history on the site only goes back to ${keyLabel(bt.startK)}.`);
  if (bt.late.length) notes.push(`${bt.late.map((h) => h.symbol).join(", ")} ${bt.late.length === 1 ? "has" : "have"} no price history back to ${keyLabel(bt.startK)}, so ${bt.late.length === 1 ? "it is" : "they are"} left out until ${bt.late.length === 1 ? "it starts" : "they start"} trading and the rest are reweighted (${pct(bt.coverage, 0, false)} of today's value is covered from the start).`);
  $("msg").innerHTML = notes.length ? `<p class="note" style="margin-top:4px">${esc(notes.join(" "))}</p>` : "";
}

// ---------------------------------------------------------------- diversification check

function renderCheck(a) {
  const top = a.hs[0];
  const flags = flagsFor(a);
  const warns = flags.filter((f) => f[0] === "warn").length;
  const headline = warns === 0
    ? `Spread across ${a.hs.length} holdings with <span class="amt">no concentration flags</span>`
    : warns === 1
      ? `Mostly spread out, with <span class="amt">one area</span> to look at`
      : `There are <span class="amt">${warns} areas</span> where your money is concentrated`;
  $("checkBody").innerHTML = `
    <h2 class="check-head">${headline}</h2>
    <p class="sub" style="margin-bottom:16px">Total value ${usd(a.total)}.</p>
    <ul class="flags">${flags.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("")}</ul>
    <div class="stats">
      <div><div class="lbl">Holdings</div><div class="big">${a.hs.length}</div><div class="hint">${a.stocks.length} individual ${a.stocks.length === 1 ? "stock" : "stocks"}</div></div>
      <div><div class="lbl">Largest holding</div><div class="big">${pct(top.w, 1, false)}</div><div class="hint">${esc(top.isCash ? "Cash" : top.symbol)}</div></div>
      <div><div class="lbl">Top 5 holdings</div><div class="big">${pct(a.top5, 0, false)}</div><div class="hint">of total value</div></div>
      <div><div class="lbl">Acts like</div><div class="big">${a.effective < 10 ? a.effective.toFixed(1) : Math.round(a.effective)}</div><div class="hint">equal-size holdings</div></div>
    </div>`;
}

function renderBars(a) {
  const rows = a.hs.slice(0, BAR_MAX);
  $("barNote").textContent = a.hs.length > BAR_MAX ? `Top ${BAR_MAX} of ${a.hs.length}` : "";
  $("barBox").style.height = rows.length * 30 + 40 + "px";
  const color = (h) => (!isStock(h) ? "#9AA5B1" : h.w > SINGLE_LIMIT ? "#B7791F" : "#102A43");
  const maxW = Math.max(...rows.map((h) => h.w));
  const plugin = {
    id: "barExtras",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      // 10% reference line, when it falls inside the chart.
      if (maxW * 100 >= SINGLE_LIMIT * 100 * 0.6) {
        const x = scales.x.getPixelForValue(SINGLE_LIMIT * 100);
        if (x <= chartArea.right) {
          ctx.strokeStyle = "#B7791F"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "#B7791F"; ctx.font = "500 11px 'Instrument Sans', system-ui, sans-serif"; ctx.textAlign = "center";
          ctx.fillText("10%", x, chartArea.top - 6);
        }
      }
      ctx.font = "500 12px 'Instrument Sans', system-ui, sans-serif";
      ctx.fillStyle = "#52606D"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(pct(rows[i].w, 1, false), bar.x + 6, bar.y));
      ctx.restore();
    },
  };
  if (CHARTS.barChart) CHARTS.barChart.destroy();
  CHARTS.barChart = new Chart($("barChart"), {
    type: "bar",
    data: {
      labels: rows.map((h) => (h.isCash ? "Cash" : h.symbol)),
      datasets: [{ data: rows.map((h) => h.w * 100), backgroundColor: rows.map(color), borderRadius: 4, borderSkipped: "start", barThickness: 18 }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 52, top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${usd(rows[c.dataIndex].value)} (${pct(rows[c.dataIndex].w, 1, false)})`, afterLabel: (c) => rows[c.dataIndex].name || "" } },
      },
      scales: {
        x: { beginAtZero: true, suggestedMax: Math.max(SINGLE_LIMIT * 100 * 1.2, maxW * 100), grid: { color: "#E6EBF0" }, border: { display: false }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => v + "%" } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: "#102A43", font: { family: "Instrument Sans", size: 13, weight: 600 } } },
      },
    },
    plugins: [plugin],
  });
}

function donut(id, rows, colors) {
  const plugin = {
    id: "sliceLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        if (rows[i].w < 0.05) return;
        const ang = (arc.startAngle + arc.endAngle) / 2, rr = (arc.outerRadius + arc.innerRadius) / 2;
        ctx.fillStyle = textOn(colors[i]);
        ctx.fillText(`${Math.round(rows[i].w * 100)}%`, arc.x + Math.cos(ang) * rr, arc.y + Math.sin(ang) * rr);
      });
      ctx.restore();
    },
  };
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart($(id), {
    type: "doughnut",
    data: { labels: rows.map((r) => r.key), datasets: [{ data: rows.map((r) => r.w * 100), backgroundColor: colors, borderColor: "#F6F8F7", borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, cutout: "48%", layout: { padding: 8 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${rows[c.dataIndex].key}: ${pct(rows[c.dataIndex].w, 1, false)} (${usd(rows[c.dataIndex].value)})` } } },
    },
    plugins: [plugin],
  });
}

function legendTable(id, rows, colors) {
  $(id).innerHTML = `<tbody>${rows.map((r, i) => `<tr>
    <td><span class="sw" style="background:${colors[i]}"></span>${esc(r.key)}</td>
    <td class="num">${pct(r.w, 1, false)}</td>
    <td class="tk">${esc(r.syms.length > 6 ? r.syms.slice(0, 6).join(", ") + ` +${r.syms.length - 6}` : r.syms.join(", "))}</td>
  </tr>`).join("")}</tbody>`;
}

function renderMix(a) {
  const ac = a.assets.map((r) => ASSET_COLORS[r.key] || "#9AA5B1");
  const sc = a.sectors.map((r) => SECTOR_COLORS[r.key] || "#9AA5B1");
  donut("assetPie", a.assets, ac);
  donut("sectorPie", a.sectors, sc);
  legendTable("assetTable", a.assets, ac);
  legendTable("sectorTable", a.sectors, sc);
}

function renderTable(a) {
  $("holdNote").textContent = `${a.hs.length} holdings, ${usd(a.total)}`;
  $("holdTable").innerHTML = `
    <thead><tr><th>Holding</th><th>Asset class</th><th>Sector</th><th class="num">Value</th><th class="num">Weight</th></tr></thead>
    <tbody>${a.hs.map((h) => `<tr>
      <td><span class="tick">${esc(h.isCash ? "Cash" : h.symbol)}</span>${h.name && !h.isCash ? `<span class="name">${esc(h.name)}</span>` : ""}</td>
      <td>${esc(assetOf(h))}</td>
      <td>${esc(sectorOf(h))}</td>
      <td class="num">${usd(h.value)}</td>
      <td class="num ${isStock(h) && h.w > SINGLE_LIMIT ? "down" : ""}">${pct(h.w, 1, false)}</td>
    </tr>`).join("")}</tbody>`;
}

// ---------------------------------------------------------------- loading

async function run(list, source) {
  state.holdings = list;
  state.source = source;
  $("loadMsg").innerHTML = "";
  const { missing, limited } = await valueHoldings(list);
  if (missing.length) $("loadMsg").innerHTML = `<div class="warnbox">No price found for ${missing.map(esc).join(", ")}, so ${missing.length === 1 ? "it is" : "they are"} left out. ${missing.some((m) => limited.includes(m)) ? "The free data plans' limits were reached; reload in a few minutes." : "Check the ticker."}</div>`;
  const other = list.filter((h) => h.priced && sectorOf(h) === "Other").map((h) => h.symbol);
  if (other.length) $("loadMsg").innerHTML += `<div class="warnbox">${other.map(esc).join(", ")} ${other.length === 1 ? "isn't" : "aren't"} in the sector list yet, so ${other.length === 1 ? "it shows" : "they show"} as Other. Add ${other.length === 1 ? "it" : "them"} to sectors.js.</div>`;
  if (!list.some((h) => h.priced)) {
    $("loadMsg").innerHTML += `<div class="warnbox">None of these holdings could be valued, so there's nothing to show yet.</div>`;
    return;
  }
  const a = (state.a = analyze(list));
  const hasBench = DATA.series[BENCH] && DATA.series[BENCH].map;
  $("results").hidden = !hasBench;
  ["mixSection", "holdSection", "barSection"].forEach((id) => ($(id).hidden = false));
  if (hasBench) renderGrowth(a);
  else $("loadMsg").innerHTML += `<div class="warnbox">S&amp;P 500 history couldn't be loaded, so the growth chart is hidden. Reload in a few minutes.</div>`;
  renderCheck(a);
  renderMix(a);
  renderTable(a);
  renderBars(a);
  $(hasBench ? "results" : "mixSection").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function showError(e) { $("loadMsg").innerHTML = `<div class="warnbox">${esc(e.message || e)}</div>`; }

function fromSaved(p) {
  return p.holdings.map((h) => ({ ...h, value: h.shares != null && !h.isCash ? null : h.value }));
}

function readFile(file) {
  if (!file) return;
  $("fileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
        let data;
        try { data = JSON.parse(text); } catch { throw new Error("This file isn't a portfolio file from this site."); }
        const p = (Array.isArray(data.portfolios) ? data.portfolios : [data]).map(cleanPortfolio).filter(Boolean)[0];
        if (!p) throw new Error("No portfolio found in this file.");
        run(fromSaved(p), p.name);
      } else run(holdingsFromCSV(text), `From ${file.name}`);
    } catch (e) { showError(e); }
  };
  reader.readAsText(file);
}

function fillSaved() {
  const list = readSaved();
  $("savedRow").hidden = !list.length;
  $("savedSel").innerHTML = `<option value="">Choose…</option>` + list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.holdings.length} holdings)</option>`).join("");
}

const drop = $("drop");
drop.addEventListener("click", () => $("file").click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer.files[0]); });
$("file").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
$("manualBtn").addEventListener("click", () => {
  try { run(holdingsFromText($("manual").value), "Entered by hand"); } catch (e) { showError(e); }
});
$("savedSel").addEventListener("change", (e) => {
  const p = readSaved().find((x) => x.id === e.target.value);
  if (p) run(fromSaved(p), p.name);
});
document.querySelectorAll("#periods button").forEach((b) => b.addEventListener("click", () => {
  state.years = Number(b.dataset.years);
  document.querySelectorAll("#periods button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (state.a && DATA.series[BENCH]) renderGrowth(state.a);
}));
$("progress").addEventListener("click", (e) => { if (e.target.id === "stopWait") DATA.stopWaiting = true; });
fillSaved();

// Open the portfolio last loaded on the Analyze tab, if there is one.
const last = getLastLoaded();
if (last) run(fromSaved(last), last.name || "Last loaded on Analyze");
