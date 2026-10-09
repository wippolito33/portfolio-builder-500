// Annual Sector Select: every January, rebalance into that year's two largest
// stocks per sector (equal weight) and hold until the next January.
//
// Month keys are year*12 + monthIndex (Jan = 0). Rebalancing "on January 1"
// uses the December close. The picks used are the ones for the calendar year
// the holding period falls in.

const START = 10000;
const YEARS = Object.keys(ANNUAL_PICKS).map(Number).sort((a, b) => a - b);
const COLORS = { strategy: "#B7791F", today: "#52606D", bench: "#102A43" };
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
const SECTOR_ORDER = Object.keys(SECTOR_COLORS);

const st = { years: 10, run: null, mixYear: null, mixView: "start" };

const clampYear = (y) => Math.min(Math.max(y, YEARS[0]), YEARS[YEARS.length - 1]);
const picksFor = (year) => Object.values(ANNUAL_PICKS[clampYear(year)]).flat();
const sectorOf = (year, sym) => Object.entries(ANNUAL_PICKS[clampYear(year)]).find(([, l]) => l.includes(sym))[0];
const yearOf = (k) => Math.floor((k + 1) / 12);      // the close at k starts month k+1
const isJanRebalance = (k) => (k + 1) % 12 === 0;    // December close

function setStatus(kind, text) {
  $("dot").className = "dot " + (kind || "");
  $("statusText").textContent = text;
}
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#102A43" : "#FFFFFF";
}

// ---------------------------------------------------------------- the strategy

// Buys on day one at startK with that date's picks, then rebalances every January.
function simulate(startK, endK) {
  let value = START;
  const path = [value];
  const periods = [];
  let cur = null;
  const buy = (k) => {
    const year = yearOf(k);
    const wanted = picksFor(year);
    const held = wanted.filter((s) => DATA.series[s] && DATA.series[s].first <= k && priceAt(DATA.series[s], k));
    cur = {
      year, k, startValue: value, wanted, held,
      missing: wanted.filter((s) => !held.includes(s)),
      shares: held.map((s) => ({ s, n: value / held.length / priceAt(DATA.series[s], k) })),
    };
    periods.push(cur);
  };
  buy(startK);
  for (let k = startK + 1; k <= endK; k++) {
    value = cur.shares.reduce((a, h) => a + h.n * priceAt(DATA.series[h.s], k), 0);
    path.push(value);
    if (k < endK && isJanRebalance(k)) { cur.endK = k; cur.ret = value / cur.startValue - 1; buy(k); }
  }
  cur.endK = endK; cur.ret = value / cur.startValue - 1;
  return { path, periods };
}

function backtest(years) {
  const endK = DATA.series[BENCH].last;
  const startK = endK - years * 12;
  const { path, periods } = simulate(startK, endK);
  const latest = picksFor(YEARS[YEARS.length - 1]);
  const today = latest.filter((s) => DATA.series[s] && DATA.series[s].first <= startK);
  const todayPath = [], benchPath = [], labels = [];
  for (let k = startK; k <= endK; k++) {
    labels.push(keyLabel(k));
    todayPath.push(today.reduce((a, s) => a + (START / today.length) * priceAt(DATA.series[s], k) / priceAt(DATA.series[s], startK), 0));
    benchPath.push(START * priceAt(DATA.series[BENCH], k) / priceAt(DATA.series[BENCH], startK));
  }
  const toRets = (p) => p.slice(1).map((v, i) => v / p[i] - 1);
  return {
    years, startK, endK, labels, periods, today, todayMissing: latest.filter((s) => !today.includes(s)),
    strategy: { values: path, ...stats(toRets(path)) },
    held: { values: todayPath, ...stats(toRets(todayPath)) },
    bench: { values: benchPath, ...stats(toRets(benchPath)) },
  };
}

// ---------------------------------------------------------------- render

function renderHero(bt) {
  const rebalances = bt.periods.length - 1;
  let changes = 0;
  for (let i = 1; i < bt.periods.length; i++) changes += bt.periods[i].wanted.filter((s) => !bt.periods[i - 1].wanted.includes(s)).length;
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
    <h2 class="headline">$10,000 invested ${ago} ago is worth <span class="amt">${usd(bt.strategy.end)}</span> today</h2>
    <p class="sub">Started ${keyLabel(bt.startK)} with that year's top two stocks per sector, equal weight. ${
      rebalances ? `Rebalanced ${rebalances === 1 ? "once" : rebalances + " times"} each January since, swapping ${changes} ${changes === 1 ? "stock" : "stocks"} in total.` : "No January rebalance yet in this period."
    } Dividends reinvested.</p>
    <div class="compare">
      ${card("Annual Sector Select", COLORS.strategy, bt.strategy)}
      ${card(`Today's ${bt.today.length}, held the whole time`, COLORS.today, bt.held)}
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
        ds("Annual Sector Select", bt.strategy.values, COLORS.strategy, 2.5),
        ds(`Today's ${bt.today.length}, held the whole time`, bt.held.values, COLORS.today, 1.5, [5, 4]),
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
  const notes = [];
  if (bt.todayMissing.length) notes.push(`${bt.todayMissing.join(", ")} ${bt.todayMissing.length === 1 ? "is" : "are"} left out of "Today's ${bt.today.length}" because ${bt.todayMissing.length === 1 ? "it has" : "they have"} no price history back to ${keyLabel(bt.startK)}.`);
  const gaps = bt.periods.filter((p) => p.missing.length);
  if (gaps.length) notes.push(gaps.map((p) => `${p.year}: no price history for ${p.missing.join(", ")}, so that year held ${p.held.length}.`).join(" "));
  $("msg").innerHTML = notes.length ? `<p class="note" style="margin-top:4px">${esc(notes.join(" "))}</p>` : "";
}

function renderYears(bt) {
  $("yearTable").innerHTML = `
    <thead><tr><th>Year</th><th class="num">Annual Sector Select</th><th class="num">S&amp;P 500</th><th class="num">Difference</th><th>Bought in January</th><th>Sold in January</th></tr></thead>
    <tbody>${bt.periods.map((p, i) => {
      const spy = priceAt(DATA.series[BENCH], p.endK) / priceAt(DATA.series[BENCH], p.k) - 1;
      const prev = i ? bt.periods[i - 1].wanted : null;
      const added = prev ? p.wanted.filter((s) => !prev.includes(s)) : [];
      const removed = prev ? prev.filter((s) => !p.wanted.includes(s)) : [];
      const partialStart = i === 0 && !isJanRebalance(p.k);
      const partialEnd = p.endK - p.k < 12 && i === bt.periods.length - 1;
      return `<tr>
        <td>${p.year}${partialStart ? ` <span class="note">from ${keyLabel(p.k)}</span>` : partialEnd ? ` <span class="note">so far</span>` : ""}</td>
        <td class="num ${cls(p.ret)}">${pct(p.ret)}</td>
        <td class="num ${cls(spy)}">${pct(spy)}</td>
        <td class="num ${cls(p.ret - spy)}">${pct(p.ret - spy)}</td>
        <td>${i === 0 ? `Starting ${p.held.length}` : added.join(", ") || "No changes"}</td>
        <td>${removed.join(", ") || "—"}</td>
      </tr>`;
    }).join("")}</tbody>`;

  const shown = [...new Set(bt.periods.map((p) => p.year))];
  $("picksTable").innerHTML = `
    <thead><tr><th>Sector</th>${shown.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
    <tbody>${SECTOR_ORDER.map((sec) => `<tr><td>${esc(sec)}</td>${shown.map((y, i) => {
      const prev = i ? ANNUAL_PICKS[clampYear(shown[i - 1])][sec] : null;
      return `<td>${ANNUAL_PICKS[clampYear(y)][sec].map((s) => `<span class="${prev && !prev.includes(s) ? "new" : ""}">${s}</span>`).join(", ")}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
}

function fillYearSelect(bt) {
  const years = bt.periods.map((p) => p.year);
  if (!years.includes(st.mixYear)) st.mixYear = years[years.length - 1];
  $("mixYear").innerHTML = [...years].reverse().map((y) => `<option value="${y}" ${y === st.mixYear ? "selected" : ""}>${y}</option>`).join("");
}

function renderMix(bt) {
  const p = bt.periods.find((x) => x.year === st.mixYear) || bt.periods[bt.periods.length - 1];
  const isCurrent = p === bt.periods[bt.periods.length - 1];
  $("mixSeg").querySelector('[data-v="end"]').textContent = isCurrent ? "Today" : "Year end";

  const bySector = new Map();
  for (const h of p.shares) {
    const v = st.mixView === "end" ? h.n * priceAt(DATA.series[h.s], p.endK) : 1;
    const sec = sectorOf(p.year, h.s);
    const e = bySector.get(sec) || { sector: sec, value: 0, syms: [] };
    e.value += v; e.syms.push(h.s);
    bySector.set(sec, e);
  }
  const total = [...bySector.values()].reduce((a, e) => a + e.value, 0);
  const rows = [...bySector.values()].map((e) => ({ ...e, w: e.value / total }));
  if (st.mixView === "end") rows.sort((a, b) => b.w - a.w);
  else rows.sort((a, b) => SECTOR_ORDER.indexOf(a.sector) - SECTOR_ORDER.indexOf(b.sector));

  $("mixSection").hidden = false;
  $("mixNote").textContent = st.mixView === "start"
    ? `${p.held.length} stocks at ${(100 / p.held.length).toFixed(p.held.length === 22 ? 2 : 2)}% each, bought ${keyLabel(p.k)}. Every sector starts the year at the same weight.`
    : `Where the money sat at ${isCurrent ? "today's prices" : "the end of " + p.year}, before the next January rebalance. Winners grow into bigger slices.`;

  const colors = rows.map((r) => SECTOR_COLORS[r.sector] || "#8A96A3");
  const narrow = () => $("pie").parentElement.clientWidth < 640;
  const labelsPlugin = {
    id: "labels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const arcs = chart.getDatasetMeta(0).data;
      ctx.save();
      if (narrow()) {
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
      ctx.strokeStyle = "#9AA5B1"; ctx.lineWidth = 1;
      arcs.forEach((arc, i) => {
        const a = (arc.startAngle + arc.endAngle) / 2, r = arc.outerRadius;
        const x1 = arc.x + Math.cos(a) * (r + 4), y1 = arc.y + Math.sin(a) * (r + 4);
        const x2 = arc.x + Math.cos(a) * (r + 16), y2 = arc.y + Math.sin(a) * (r + 16);
        const right = Math.cos(a) >= 0, x3 = x2 + (right ? 10 : -10);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y2); ctx.stroke();
        ctx.fillStyle = "#102A43"; ctx.textAlign = right ? "left" : "right"; ctx.textBaseline = "middle";
        ctx.fillText(`${rows[i].sector} ${(rows[i].w * 100).toFixed(1)}%`, x3 + (right ? 4 : -4), y2);
      });
      ctx.restore();
    },
  };
  if (CHARTS.pie) CHARTS.pie.destroy();
  CHARTS.pie = new Chart($("pie"), {
    type: "doughnut",
    data: { labels: rows.map((r) => r.sector), datasets: [{ data: rows.map((r) => r.w * 100), backgroundColor: colors, borderColor: "#F6F8F7", borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, cutout: 0,
      layout: { padding: narrow() ? 8 : { top: 30, bottom: 30, left: 200, right: 200 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${(rows[c.dataIndex].w * 100).toFixed(1)}%: ${rows[c.dataIndex].syms.join(", ")}` } } },
    },
    plugins: [labelsPlugin],
  });
  $("mixTable").innerHTML = `<tbody>${rows.map((r, i) => `<tr>
    <td><span class="sw" style="background:${colors[i]}"></span>${r.sector}</td>
    <td class="num">${(r.w * 100).toFixed(1)}%</td>
    <td class="tk">${r.syms.join(", ")}</td>
  </tr>`).join("")}</tbody>`;
}

function renderAll() {
  if (!DATA.series[BENCH]) return;
  const bt = (st.run = backtest(st.years));
  renderHero(bt);
  renderChart(bt);
  fillYearSelect(bt);
  renderMix(bt);
  renderYears(bt);
  $("yearsSection").hidden = false;
}

// ---------------------------------------------------------------- loading and wiring

async function start() {
  const syms = [...new Set(YEARS.flatMap(picksFor).concat(BENCH))];
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
$("mixYear").addEventListener("change", (e) => { st.mixYear = Number(e.target.value); if (st.run) renderMix(st.run); });
$("mixSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  st.mixView = b.dataset.v;
  $("mixSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (st.run) renderMix(st.run);
}));
start();
