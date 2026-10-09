// Aggressive Growth Model: target sleeves from growth-model.js, rebalanced to
// target every January (December close) and held through the year.
//
// Month keys are year*12 + monthIndex (Jan = 0), as on the other pages.

const START = 10000;
const COLORS = { model: "#B7791F", drift: "#52606D", bench: "#102A43" };
const SLEEVES = GROWTH_MODEL;
const ALL = SLEEVES.flatMap((sl) => sl.holdings.map(([s, name]) => ({ s, name, sleeve: sl })));
const NAME = Object.fromEntries(ALL.map((h) => [h.s, h.name]));

const st = { years: 10, run: null, mixView: "target", quotes: null };

const yearOf = (k) => Math.floor((k + 1) / 12);
const isJanRebalance = (k) => (k + 1) % 12 === 0;
const hasPrice = (s, k) => DATA.series[s] && DATA.series[s].first <= k && priceAt(DATA.series[s], k);

function setStatus(kind, text) {
  $("dot").className = "dot " + (kind || "");
  $("statusText").textContent = text;
}
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#102A43" : "#FFFFFF";
}

// ---------------------------------------------------------------- the model

// Target weight for each stock at month k: sleeve weight split equally among
// the sleeve's holdings that have a price. Sleeves with no prices at all are
// spread across the others in proportion to their targets.
function targetsAt(k) {
  const live = SLEEVES.map((sl) => ({ sl, held: sl.holdings.map(([s]) => s).filter((s) => hasPrice(s, k)) }));
  const covered = live.filter((x) => x.held.length).reduce((a, x) => a + x.sl.weight, 0);
  const weights = {};
  for (const x of live) for (const s of x.held) weights[s] = x.sl.weight / covered / x.held.length;
  return {
    weights,
    missing: live.flatMap((x) => x.sl.holdings.map(([s]) => s).filter((s) => !x.held.includes(s))),
    emptySleeves: live.filter((x) => !x.held.length).map((x) => x.sl.name),
  };
}

function simulate(startK, endK, rebalance) {
  let value = START;
  const path = [value], periods = [];
  let cur = null;
  const buy = (k) => {
    const t = targetsAt(k);
    cur = {
      year: yearOf(k), k, startValue: value, ...t,
      shares: Object.entries(t.weights).map(([s, w]) => ({ s, n: (value * w) / priceAt(DATA.series[s], k) })),
    };
    periods.push(cur);
  };
  buy(startK);
  for (let k = startK + 1; k <= endK; k++) {
    value = cur.shares.reduce((a, h) => a + h.n * priceAt(DATA.series[h.s], k), 0);
    path.push(value);
    if (rebalance && k < endK && isJanRebalance(k)) { cur.endK = k; cur.ret = value / cur.startValue - 1; buy(k); }
  }
  cur.endK = endK; cur.ret = value / cur.startValue - 1;
  return { path, periods };
}

function backtest(years) {
  const endK = DATA.series[BENCH].last;
  const startK = endK - years * 12;
  const model = simulate(startK, endK, true);
  const drift = simulate(startK, endK, false);
  const benchPath = [], labels = [];
  for (let k = startK; k <= endK; k++) {
    labels.push(keyLabel(k));
    benchPath.push(START * priceAt(DATA.series[BENCH], k) / priceAt(DATA.series[BENCH], startK));
  }
  const toRets = (p) => p.slice(1).map((v, i) => v / p[i] - 1);
  return {
    years, startK, endK, labels, periods: model.periods,
    model: { values: model.path, ...stats(toRets(model.path)) },
    drift: { values: drift.path, ...stats(toRets(drift.path)) },
    bench: { values: benchPath, ...stats(toRets(benchPath)) },
  };
}

// ---------------------------------------------------------------- render

function renderHero(bt) {
  const rebalances = bt.periods.length - 1;
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
  const ago = bt.years === 1 ? "a year" : `${bt.years} years`;
  $("heroBody").innerHTML = `
    <h2 class="headline">$10,000 invested ${ago} ago is worth <span class="amt">${usd(bt.model.end)}</span> today</h2>
    <p class="sub">Started ${keyLabel(bt.startK)} at target weights: 95% equities, 5% bonds and cash. ${
      rebalances ? `Rebalanced to target ${rebalances === 1 ? "once" : rebalances + " times"} each January since.` : "No January rebalance yet in this period."
    } Dividends reinvested.</p>
    <div class="compare">
      ${card("Aggressive Growth Model", COLORS.model, bt.model)}
      ${card("Same start, never rebalanced", COLORS.drift, bt.drift, true)}
      ${card("S&P 500 (SPY)", COLORS.bench, bt.bench)}
    </div>`;
}

function renderChart(bt) {
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
        ds("Aggressive Growth Model", bt.model.values, COLORS.model, 2.5),
        ds("Same start, never rebalanced", bt.drift.values, COLORS.drift, 1.5, [5, 4]),
        ds("S&P 500 (SPY)", bt.bench.values, COLORS.bench, 1.5),
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
  const gaps = bt.periods.filter((p) => p.missing.length);
  const notes = gaps.map((p) => `${p.year}: no price history yet for ${p.missing.join(", ")}${p.emptySleeves.length ? ` (${p.emptySleeves.join(", ")} spread across the other sleeves)` : ""}.`);
  $("msg").innerHTML = notes.length ? `<p class="note" style="margin-top:4px">${esc(notes.join(" "))}</p>` : "";
}

// Today's weight of each stock: what the January buy has grown into.
function todayWeights(bt) {
  const p = bt.periods[bt.periods.length - 1];
  const vals = p.shares.map((h) => [h.s, h.n * priceAt(DATA.series[h.s], bt.endK)]);
  const total = vals.reduce((a, [, v]) => a + v, 0);
  return { since: p.k, w: Object.fromEntries(vals.map(([s, v]) => [s, v / total])) };
}

function renderMix(bt) {
  const today = todayWeights(bt);
  const rows = SLEEVES.map((sl) => {
    const syms = sl.holdings.map(([s]) => s);
    const now = syms.reduce((a, s) => a + (today.w[s] || 0), 0);
    return { sl, syms, w: st.mixView === "target" ? sl.weight : now, target: sl.weight, now };
  });
  const equity = rows.filter((r) => ["large", "mid", "tech", "intl", "em"].includes(r.sl.id)).reduce((a, r) => a + r.w, 0);

  $("mixSection").hidden = false;
  $("mixNote").textContent = st.mixView === "target"
    ? "Target weights the model rebalances back to every January."
    : `Where the money sits at the latest close, after drifting since the ${keyLabel(today.since)} rebalance. A sleeve more than 5 points off target is flagged.`;

  const colors = rows.map((r) => r.sl.color);
  const labelsPlugin = {
    id: "labels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        if (rows[i].w < 0.05) return;
        const a = (arc.startAngle + arc.endAngle) / 2, rr = (arc.outerRadius + arc.innerRadius) / 2;
        ctx.fillStyle = textOn(colors[i]);
        ctx.fillText(`${Math.round(rows[i].w * 100)}%`, arc.x + Math.cos(a) * rr, arc.y + Math.sin(a) * rr);
      });
      ctx.restore();
    },
  };
  if (CHARTS.pie) CHARTS.pie.destroy();
  CHARTS.pie = new Chart($("pie"), {
    type: "doughnut",
    data: { labels: rows.map((r) => r.sl.name), datasets: [{ data: rows.map((r) => r.w * 100), backgroundColor: colors, borderColor: "#F6F8F7", borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, cutout: "48%",
      layout: { padding: 8 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${rows[c.dataIndex].sl.name}: ${(rows[c.dataIndex].w * 100).toFixed(1)}%` } } },
    },
    plugins: [labelsPlugin],
  });
  $("mixTable").innerHTML = `<tbody>${rows.map((r) => {
    const off = r.now - r.target;
    const flag = st.mixView === "today" && Math.abs(off) > 0.05;
    return `<tr>
      <td><span class="sw" style="background:${r.sl.color}"></span>${esc(r.sl.name)}<br /><span class="role">${esc(r.sl.role)}</span></td>
      <td class="tk">${esc(r.syms.length > 3 ? r.syms.length + " stocks" : r.syms.join(", "))}</td>
      <td class="num">${(r.w * 100).toFixed(1)}%${st.mixView === "today" ? `<br /><span class="note ${flag ? "down" : ""}">${off >= 0 ? "+" : ""}${(off * 100).toFixed(1)} vs target</span>` : ""}</td>
    </tr>`;
  }).join("")}
    <tr class="sub"><td>Equities</td><td></td><td class="num">${(equity * 100).toFixed(1)}%</td></tr>
    <tr class="sub"><td>Bonds and cash</td><td></td><td class="num">${((1 - equity) * 100).toFixed(1)}%</td></tr>
  </tbody>`;
}

function renderHoldings(bt) {
  const today = todayWeights(bt);
  const q = st.quotes || {};
  const anyQuote = Object.keys(q).length > 0;
  $("holdingsSection").hidden = false;
  $("quoteNote").textContent = anyQuote
    ? "Prices from Tiingo, may be delayed. 1-yr return includes dividends."
    : `Latest prices unavailable right now; showing returns through ${keyLabel(bt.endK)}.`;
  $("holdingsTable").innerHTML = `
    <thead><tr><th>Sleeve</th><th>Holding</th><th class="num">Target</th><th class="num">Today</th><th class="num">Price</th><th class="num">Day</th><th class="num">1-yr return</th></tr></thead>
    <tbody>${SLEEVES.map((sl) => sl.holdings.map(([s, name], i) => {
      const target = sl.weight / sl.holdings.length;
      const now = today.w[s];
      const series = DATA.series[s];
      const r1 = series && hasPrice(s, bt.endK - 12) ? priceAt(series, bt.endK) / priceAt(series, bt.endK - 12) - 1 : null;
      const qq = q[s] || {};
      const day = qq.changePct != null ? qq.changePct / 100 : null;
      return `<tr class="${i === 0 ? "sector-start" : ""}">
        <td class="sleeve">${i === 0 ? `<span class="sw" style="background:${sl.color}"></span>${esc(sl.name)}` : ""}</td>
        <td><span class="tick">${esc(s)}</span><span class="name">${esc(name)}</span></td>
        <td class="num">${(target * 100).toFixed(2)}%</td>
        <td class="num">${now != null ? (now * 100).toFixed(2) + "%" : "—"}</td>
        <td class="num">${qq.price != null ? usd(qq.price, 2) : "—"}</td>
        <td class="num ${cls(day)}">${pct(day, 2)}</td>
        <td class="num ${cls(r1)}">${pct(r1)}</td>
      </tr>`;
    }).join("")).join("")}</tbody>`;
}

function renderYears(bt) {
  $("yearsSection").hidden = false;
  $("yearTable").innerHTML = `
    <thead><tr><th>Year</th><th class="num">Aggressive Growth Model</th><th class="num">S&amp;P 500</th><th class="num">Difference</th><th>Not yet trading</th></tr></thead>
    <tbody>${bt.periods.map((p, i) => {
      const spy = priceAt(DATA.series[BENCH], p.endK) / priceAt(DATA.series[BENCH], p.k) - 1;
      const partialStart = i === 0 && !isJanRebalance(p.k);
      const partialEnd = p.endK - p.k < 12 && i === bt.periods.length - 1;
      return `<tr>
        <td>${p.year}${partialStart ? ` <span class="note">from ${keyLabel(p.k)}</span>` : partialEnd ? ` <span class="note">so far</span>` : ""}</td>
        <td class="num ${cls(p.ret)}">${pct(p.ret)}</td>
        <td class="num ${cls(spy)}">${pct(spy)}</td>
        <td class="num ${cls(p.ret - spy)}">${pct(p.ret - spy)}</td>
        <td>${p.missing.join(", ") || "—"}</td>
      </tr>`;
    }).join("")}</tbody>`;
}

function renderAll() {
  if (!DATA.series[BENCH]) return;
  const bt = (st.run = backtest(st.years));
  renderHero(bt);
  renderChart(bt);
  renderMix(bt);
  renderHoldings(bt);
  renderYears(bt);
}

// ---------------------------------------------------------------- loading and wiring

async function loadQuotes() {
  try {
    const r = await fetch("/api/quotes?symbols=" + encodeURIComponent(ALL.map((h) => h.s).join(",")));
    const d = await r.json();
    if (d && d.quotes) { st.quotes = d.quotes; if (st.run) renderHoldings(st.run); }
  } catch { /* the table still shows returns from saved history */ }
}

async function start() {
  const syms = [...new Set(ALL.map((h) => h.s).concat(BENCH))];
  loadQuotes();
  await loadAll(
    syms,
    (d, n) => setStatus("warn", `Loaded price history for ${d} of ${n}`),
    (secs, d, n) => setStatus("warn", `Loaded ${d} of ${n}. The free data plans allow only so many requests a minute; continuing in ${secs}s`)
  );
  if (!DATA.series[BENCH] || !DATA.series[BENCH].map) {
    setStatus("warn", "S&P 500 history couldn't be loaded");
    $("heroBody").innerHTML = `<p class="loading">Price history couldn't be loaded yet. Reload the page in a few minutes.</p>`;
    return;
  }
  const none = syms.filter((s) => !DATA.series[s]);
  if (none.length) setStatus("warn", `Missing price history for ${none.join(", ")}; reload later to retry`);
  else setStatus("live", `End-of-day prices through ${keyLabel(DATA.series[BENCH].last)}`);
  renderAll();
}

document.querySelectorAll(".periods button").forEach((b) => b.addEventListener("click", () => {
  st.years = Number(b.dataset.years);
  document.querySelectorAll(".periods button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderAll();
}));
$("mixSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  st.mixView = b.dataset.v;
  $("mixSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (st.run) renderMix(st.run);
}));
start();
