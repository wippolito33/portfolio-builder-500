// Annual Sector Select: rebalance into each year's top two per sector every
// January 1 (using the December close), hold through the year.

const START = 10000;
const YEARS = Object.keys(ANNUAL_PICKS).map(Number).sort((a, b) => a - b);
const COL = { annual: C.swap, today: "#52606D", bench: C.bench };

// Month key of the December close before a year starts (the rebalance price).
const decBefore = (year) => (year - 1) * 12 + 11;
const picksFor = (year) => Object.values(ANNUAL_PICKS[year]).flat();

function run() {
  const endK = DATA.series[BENCH].last;
  const startK = decBefore(YEARS[0]);
  const labels = [];
  for (let k = startK; k <= endK; k++) labels.push(keyLabel(k));

  // Annual Sector Select path, plus what each year held.
  let value = START;
  const path = [value];
  const years = [];
  for (const y of YEARS) {
    const y0 = decBefore(y), y1 = Math.min(decBefore(y + 1), endK);
    if (y0 >= endK) break;
    const wanted = picksFor(y);
    const held = wanted.filter((s) => priceAt(DATA.series[s], y0) && DATA.series[s].first <= y0);
    const missing = wanted.filter((s) => !held.includes(s));
    const shares = held.map((s) => ({ s, n: value / held.length / priceAt(DATA.series[s], y0) }));
    const startValue = value;
    for (let k = y0 + 1; k <= y1; k++) {
      value = shares.reduce((a, h) => a + h.n * priceAt(DATA.series[h.s], k), 0);
      path.push(value);
    }
    const prev = ANNUAL_PICKS[y - 1] ? picksFor(y - 1) : null;
    years.push({
      year: y, ytd: y1 < decBefore(y + 1), ret: value / startValue - 1, held, missing,
      added: prev ? wanted.filter((s) => !prev.includes(s)) : [],
      removed: prev ? prev.filter((s) => !wanted.includes(s)) : [],
      spy: priceAt(DATA.series[BENCH], y1) / priceAt(DATA.series[BENCH], y0) - 1,
    });
  }

  // Today's 22 (the latest year's picks) bought in Jan 2022 and held, equal weight.
  const today = picksFor(YEARS[YEARS.length - 1]).filter((s) => DATA.series[s] && DATA.series[s].first <= startK);
  const todayPath = [];
  for (let k = startK; k <= endK; k++) {
    todayPath.push(today.reduce((a, s) => a + (START / today.length) * priceAt(DATA.series[s], k) / priceAt(DATA.series[s], startK), 0));
  }
  const benchPath = [];
  for (let k = startK; k <= endK; k++) benchPath.push(START * priceAt(DATA.series[BENCH], k) / priceAt(DATA.series[BENCH], startK));

  const toRets = (p) => p.slice(1).map((v, i) => v / p[i] - 1);
  const sA = stats(toRets(path)), sT = stats(toRets(todayPath)), sB = stats(toRets(benchPath));
  const todayMissing = picksFor(YEARS[YEARS.length - 1]).filter((s) => !today.includes(s));

  $("headline").textContent = `$10,000 put into Annual Sector Select in January 2022 is worth ${usd(sA.end)} today, compared with ${usd(sB.end)} in the S&P 500.`;

  const cols = [["Annual Sector Select", sA], [`Today's ${today.length}, held since Jan 2022`, sT], ["S&P 500 (SPY)", sB]];
  const row = (label, f, c) => `<tr><td>${label}</td>${cols.map(([, x]) => `<td class="num ${c ? cls(c(x)) : ""}">${f(x)}</td>`).join("")}</tr>`;
  $("sumTable").innerHTML = `
    <thead><tr><th>${keyLabel(startK)} to ${keyLabel(endK)}</th>${cols.map(([h]) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("$10,000 became", (x) => usd(x.end))}
      ${row("Total return", (x) => pct(x.total), (x) => x.total)}
      ${row("Per year", (x) => pct(x.cagr), (x) => x.cagr)}
      ${row("Volatility (annual)", (x) => pct(x.vol, 1, false))}
      ${row("Worst drop", (x) => pct(x.mdd), (x) => x.mdd)}
    </tbody>`;

  lineChart("growthChart", labels, [
    line("Annual Sector Select", path, COL.annual),
    line(`Today's ${today.length}, held since Jan 2022`, todayPath, COL.today, { borderWidth: 1.5, borderDash: [2, 3] }),
    line("S&P 500 (SPY)", benchPath, COL.bench, { borderWidth: 1.5, borderDash: [6, 4] }),
  ], (v) => usd(v));
  $("growthLegend").innerHTML = legend([
    ["Annual Sector Select", COL.annual],
    [`Today's ${today.length}, held since Jan 2022 (dotted)`, COL.today, true],
    ["S&P 500 (dashed)", COL.bench, true],
  ]) + (todayMissing.length ? `<span>${todayMissing.join(", ")} left out of the dotted line: no history back to Jan 2022.</span>` : "");

  $("yearTable").innerHTML = `
    <thead><tr><th>Year</th><th class="num">Annual Sector Select</th><th class="num">S&amp;P 500</th><th class="num">Difference</th><th>Bought in January</th><th>Sold in January</th></tr></thead>
    <tbody>${years.map((y) => `<tr>
      <td>${y.year}${y.ytd ? " (so far)" : ""}</td>
      <td class="num ${cls(y.ret)}">${pct(y.ret)}</td>
      <td class="num ${cls(y.spy)}">${pct(y.spy)}</td>
      <td class="num ${cls(y.ret - y.spy)}">${pct(y.ret - y.spy)}</td>
      <td>${y.added.length ? y.added.join(", ") : y.year === YEARS[0] ? "Starting 22" : "No changes"}</td>
      <td>${y.removed.join(", ") || "—"}</td>
    </tr>`).join("")}</tbody>`;

  const sectors = Object.keys(ANNUAL_PICKS[YEARS[0]]);
  $("picksTable").innerHTML = `
    <thead><tr><th>Sector</th>${YEARS.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
    <tbody>${sectors.map((sec) => `<tr><td>${esc(sec)}</td>${YEARS.map((y, i) => {
      const prev = i ? ANNUAL_PICKS[YEARS[i - 1]][sec] : null;
      return `<td>${ANNUAL_PICKS[y][sec].map((s) => `<span class="${prev && !prev.includes(s) ? "new" : ""}">${s}</span>`).join(", ")}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;

  const gaps = years.filter((y) => y.missing.length);
  $("msg").innerHTML = gaps.length
    ? `<div class="warnbox">${gaps.map((y) => `${y.year}: no price history for ${y.missing.join(", ")}, so that year held ${y.held.length}.`).join(" ")}</div>`
    : "";
  $("results").hidden = false;
}

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
  run();
}

$("progress").addEventListener("click", (e) => { if (e.target.id === "stopWait") DATA.stopWaiting = true; });
start();
