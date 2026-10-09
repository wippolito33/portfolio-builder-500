// Annual Sector Select: each year, rebalance into that year's top two stocks
// per sector (equal weight) and hold until the next rebalance.
//
// Month keys are year*12 + monthIndex (Jan = 0). "Rebalancing at the start of
// month M" uses the close of the month before. The picks used are the ones for
// the calendar year the rebalance falls in.

const START = 10000;
const YEARS = Object.keys(ANNUAL_PICKS).map(Number).sort((a, b) => a - b);
const COL = { annual: C.swap, today: "#52606D", bench: C.bench, bar: C.cur };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SPANS = { 5: 2022, 10: 2017, 20: 2006 };

const st = { span: 20 };

const picksFor = (year) => Object.values(ANNUAL_PICKS[Math.min(Math.max(year, YEARS[0]), YEARS[YEARS.length - 1])]).flat();
const yearOfRebalance = (k) => Math.floor((k + 1) / 12);          // the close at k starts month k+1
const isRebalance = (k, month) => (k + 1) % 12 === month;          // month: 0 = January

// Runs the strategy from startK to endK, rebalancing at the start of `month`.
// It also buys on day one at startK, using that date's picks.
function simulate(month, startK, endK) {
  let value = START;
  const path = [value];
  const periods = [];
  let cur = null;

  const buy = (k) => {
    const year = yearOfRebalance(k);
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
    if (k < endK && isRebalance(k, month)) {
      cur.endK = k; cur.ret = value / cur.startValue - 1;
      buy(k);
    }
  }
  cur.endK = endK; cur.ret = value / cur.startValue - 1;
  return { path, periods };
}

function benchPath(startK, endK) {
  const p = [];
  for (let k = startK; k <= endK; k++) p.push(START * priceAt(DATA.series[BENCH], k) / priceAt(DATA.series[BENCH], startK));
  return p;
}
const toRets = (p) => p.slice(1).map((v, i) => v / p[i] - 1);
const cagr = (p, months) => Math.pow(p[p.length - 1] / p[0], 12 / months) - 1;

// ---------------------------------------------------------------- main backtest (January)

function renderMain() {
  const endK = DATA.series[BENCH].last;
  const startK = (SPANS[st.span] - 1) * 12 + 11;   // December close before the first year
  const labels = [];
  for (let k = startK; k <= endK; k++) labels.push(keyLabel(k));

  const { path, periods } = simulate(0, startK, endK);
  const latest = picksFor(YEARS[YEARS.length - 1]);
  const today = latest.filter((s) => DATA.series[s] && DATA.series[s].first <= startK);
  const todayPath = [];
  for (let k = startK; k <= endK; k++) {
    todayPath.push(today.reduce((a, s) => a + (START / today.length) * priceAt(DATA.series[s], k) / priceAt(DATA.series[s], startK), 0));
  }
  const bPath = benchPath(startK, endK);
  const sA = stats(toRets(path)), sT = stats(toRets(todayPath)), sB = stats(toRets(bPath));
  const startYear = SPANS[st.span];

  $("headline").textContent = `$10,000 put into Annual Sector Select in January ${startYear} is worth ${usd(sA.end)} today, compared with ${usd(sB.end)} in the S&P 500.`;

  const todayLabel = `Today's ${today.length}, held since Jan ${startYear}`;
  const cols = [["Annual Sector Select", sA], [todayLabel, sT], ["S&P 500 (SPY)", sB]];
  const row = (label, f, c) => `<tr><td>${label}</td>${cols.map(([, x]) => `<td class="num ${c ? cls(c(x)) : ""}">${f(x)}</td>`).join("")}</tr>`;
  $("sumTable").innerHTML = `
    <thead><tr><th>${keyLabel(startK)} to ${keyLabel(endK)}</th>${cols.map(([h]) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("$10,000 became", (x) => usd(x.end))}
      ${row("Total return", (x) => pct(x.total, 0), (x) => x.total)}
      ${row("Per year", (x) => pct(x.cagr), (x) => x.cagr)}
      ${row("Volatility (annual)", (x) => pct(x.vol, 1, false))}
      ${row("Worst drop", (x) => pct(x.mdd), (x) => x.mdd)}
    </tbody>`;

  lineChart("growthChart", labels, [
    line("Annual Sector Select", path, COL.annual),
    line(todayLabel, todayPath, COL.today, { borderWidth: 1.5, borderDash: [2, 3] }),
    line("S&P 500 (SPY)", bPath, COL.bench, { borderWidth: 1.5, borderDash: [6, 4] }),
  ], (v) => usd(v));
  const todayMissing = latest.filter((s) => !today.includes(s));
  $("growthLegend").innerHTML = legend([
    ["Annual Sector Select", COL.annual],
    [`${todayLabel} (dotted)`, COL.today, true],
    ["S&P 500 (dashed)", COL.bench, true],
  ]) + (todayMissing.length ? `<span>${todayMissing.join(", ")} left out of the dotted line: no history back to Jan ${startYear}.</span>` : "");

  $("yearTable").innerHTML = `
    <thead><tr><th>Year</th><th class="num">Annual Sector Select</th><th class="num">S&amp;P 500</th><th class="num">Difference</th><th>Bought in January</th><th>Sold in January</th></tr></thead>
    <tbody>${periods.map((p, i) => {
      const spy = priceAt(DATA.series[BENCH], p.endK) / priceAt(DATA.series[BENCH], p.k) - 1;
      const prev = i ? periods[i - 1].wanted : null;
      const added = prev ? p.wanted.filter((s) => !prev.includes(s)) : [];
      const removed = prev ? prev.filter((s) => !p.wanted.includes(s)) : [];
      return `<tr>
        <td>${p.year}${p.endK - p.k < 12 ? " (so far)" : ""}</td>
        <td class="num ${cls(p.ret)}">${pct(p.ret)}</td>
        <td class="num ${cls(spy)}">${pct(spy)}</td>
        <td class="num ${cls(p.ret - spy)}">${pct(p.ret - spy)}</td>
        <td>${i === 0 ? "Starting 22" : added.join(", ") || "No changes"}${p.missing.length ? ` <span class="note">(no data: ${p.missing.join(", ")})</span>` : ""}</td>
        <td>${removed.join(", ") || "—"}</td>
      </tr>`;
    }).join("")}</tbody>`;

  const shown = YEARS.filter((y) => y >= startYear);
  const sectors = Object.keys(ANNUAL_PICKS[YEARS[0]]);
  $("picksTable").innerHTML = `
    <thead><tr><th>Sector</th>${shown.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
    <tbody>${sectors.map((sec) => `<tr><td>${esc(sec)}</td>${shown.map((y) => {
      const prev = ANNUAL_PICKS[y - 1] ? ANNUAL_PICKS[y - 1][sec] : null;
      return `<td>${ANNUAL_PICKS[y][sec].map((s) => `<span class="${prev && y > startYear && !prev.includes(s) ? "new" : ""}">${s}</span>`).join(", ")}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
}

// ---------------------------------------------------------------- which month?

function renderMonths() {
  const endK = DATA.series[BENCH].last;
  const startK = (YEARS[0] - 1) * 12 + 11;                    // Dec 2005 close
  const midK = startK + Math.round((endK - startK) / 2);
  const months = endK - startK;

  const rows = MONTHS.map((name, m) => {
    const { path } = simulate(m, startK, endK);
    const s = stats(toRets(path));
    const half = midK - startK;
    return {
      name, m, end: s.end, cagr: s.cagr, mdd: s.mdd, vol: s.vol,
      first: cagr(path.slice(0, half + 1), half),
      second: cagr(path.slice(half), endK - midK),
    };
  });
  const bp = benchPath(startK, endK);
  const bench = { cagr: cagr(bp, months), first: cagr(bp.slice(0, midK - startK + 1), midK - startK), second: cagr(bp.slice(midK - startK), endK - midK), mdd: stats(toRets(bp)).mdd };

  const rank = (key) => {
    const sorted = [...rows].sort((a, b) => b[key] - a[key]);
    return (r) => sorted.indexOf(r) + 1;
  };
  const rAll = rank("cagr"), rFirst = rank("first"), rSecond = rank("second");
  const best = [...rows].sort((a, b) => b.cagr - a.cagr)[0];
  const worst = [...rows].sort((a, b) => a.cagr - b.cagr)[0];
  const spread = best.cagr - worst.cagr;
  const top3 = (key) => [...rows].sort((a, b) => b[key] - a[key]).slice(0, 3).map((r) => r.name);
  const overlap = top3("first").filter((n) => top3("second").includes(n));

  $("monthLede").textContent =
    `The same strategy run 12 times, each rebalancing at the start of a different month, all from ${keyLabel(startK)} to ${keyLabel(endK)}. ` +
    `${best.name} came out best at ${pct(best.cagr, 2, false)} a year and ${worst.name} worst at ${pct(worst.cagr, 2, false)}, a gap of ${(spread * 100).toFixed(2)} points a year. ` +
    (overlap.length
      ? `${overlap.join(" and ")} ${overlap.length === 1 ? "was" : "were"} in the top three in both the first and second halves of the period.`
      : `None of the top three months in the first half stayed in the top three in the second half, which points to luck rather than a real month effect.`);

  $("monthTable").innerHTML = `
    <thead><tr><th>Rebalance at the start of</th><th class="num">$10,000 became</th><th class="num">Per year</th><th class="num">Rank</th><th class="num">${keyLabel(startK)} to ${keyLabel(midK)}</th><th class="num">${keyLabel(midK)} to ${keyLabel(endK)}</th><th class="num">Worst drop</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r === best ? "current" : ""}">
      <td>${r.name}</td>
      <td class="num">${usd(r.end)}</td>
      <td class="num ${cls(r.cagr)}">${pct(r.cagr, 2)}</td>
      <td class="num">${rAll(r)}</td>
      <td class="num">${pct(r.first, 2)} <span class="cell-sub">rank ${rFirst(r)}</span></td>
      <td class="num">${pct(r.second, 2)} <span class="cell-sub">rank ${rSecond(r)}</span></td>
      <td class="num down">${pct(r.mdd)}</td>
    </tr>`).join("")}
    <tr><td>S&amp;P 500 (SPY), for reference</td><td class="num">${usd(bp[bp.length - 1])}</td><td class="num ${cls(bench.cagr)}">${pct(bench.cagr, 2)}</td><td></td>
      <td class="num">${pct(bench.first, 2)}</td><td class="num">${pct(bench.second, 2)}</td><td class="num down">${pct(bench.mdd)}</td></tr>
    </tbody>`;

  // Bar chart: return per year by rebalance month.
  if (CHARTS.monthChart) CHARTS.monthChart.destroy();
  const lo = Math.min(...rows.map((r) => r.cagr), bench.cagr), hi = Math.max(...rows.map((r) => r.cagr), bench.cagr);
  const pad = Math.max((hi - lo) * 0.6, 0.005);
  const benchLine = {
    id: "benchLine",
    afterDatasetsDraw(chart) {
      const y = chart.scales.y.getPixelForValue(bench.cagr * 100);
      const { ctx, chartArea: a } = chart;
      ctx.save();
      ctx.strokeStyle = C.bench; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = "#52606D"; ctx.font = "500 12px 'Instrument Sans', system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.fillText(`S&P 500 ${pct(bench.cagr, 2, false)}`, a.right, y - 6);
      ctx.restore();
    },
  };
  CHARTS.monthChart = new Chart($("monthChart"), {
    type: "bar",
    data: {
      labels: rows.map((r) => r.name.slice(0, 3)),
      datasets: [{ data: rows.map((r) => r.cagr * 100), backgroundColor: rows.map((r) => (r === best ? C.swap : COL.bar)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 36 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => rows[c[0].dataIndex].name, label: (c) => `${c.parsed.y.toFixed(2)}% a year, $10,000 became ${usd(rows[c.dataIndex].end)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#52606D", font: { family: "Instrument Sans" } } },
        y: { min: Math.floor((lo - pad) * 1000) / 10, max: Math.ceil((hi + pad) * 1000) / 10, grid: { color: "#E6EBF0" }, border: { display: false },
             ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => v.toFixed(1) + "%" } },
      },
    },
    plugins: [benchLine],
  });
  $("monthLegend").innerHTML = legend([[`Best month (${best.name})`, C.swap], ["Other months", COL.bar], ["S&P 500 (dashed)", C.bench, true]]) +
    `<span>The vertical scale is zoomed in, so small differences look larger than they are.</span>`;
}

// ---------------------------------------------------------------- loading

async function start() {
  const syms = [...new Set(YEARS.flatMap(picksFor).concat(BENCH))];
  await loadAll(
    syms,
    (d, n) => ($("progress").textContent = d < n ? `Loading price history: ${d} of ${n}` : ""),
    (secs, d, n) => ($("progress").innerHTML =
      `Loaded ${d} of ${n}. The free data plans allow only so many requests a minute, so loading continues in ${secs}s. ` +
      `<button type="button" class="ghost" id="stopWait">Show results with what's loaded</button>`)
  );
  $("progress").textContent = "";
  if (!DATA.series[BENCH] || !DATA.series[BENCH].map) {
    $("msg").innerHTML = `<div class="error">S&amp;P 500 history couldn't be loaded yet. Reload the page in a few minutes.</div>`;
    return;
  }
  const none = syms.filter((s) => !DATA.series[s] || !DATA.series[s].map);
  $("msg").innerHTML = none.length
    ? `<div class="warnbox">No price history loaded for ${none.join(", ")}. Years that picked ${none.length === 1 ? "it" : "them"} hold the rest equally${none.some((s) => !DATA.series[s]) ? "; reload in a few minutes to try again" : ""}.</div>`
    : "";
  renderMain();
  renderMonths();
  $("results").hidden = false;
  $("months").hidden = false;
}

$("progress").addEventListener("click", (e) => { if (e.target.id === "stopWait") DATA.stopWaiting = true; });
$("spanSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  st.span = Number(b.dataset.y);
  $("spanSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (DATA.series[BENCH]) renderMain();
}));
start();
