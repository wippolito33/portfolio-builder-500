// Portfolio Builder 500: compare one of your portfolios with the sector
// portfolio over 1, 3, 5, 10 and 20 years. Runs in the browser; only ticker
// symbols are sent to the site's data functions.

const DROP_COUNT = 2;
const COL = { yours: C.cur, sector: C.swap, all: "#52606D", bench: C.bench };

const cmp = { picks: null, name: "", holdings: [], endK: null, years: 10 };

function toSeries(pts, meta) {
  const map = new Map();
  for (const p of pts) map.set(monthKey(p.t), p.p);
  const keys = [...map.keys()];
  return { map, first: Math.min(...keys), last: Math.max(...keys), lastPrice: pts[pts.length - 1].p, source: (meta && meta.source) || "tiingo", adjusted: !meta || meta.adjusted !== false };
}

// The 22 sector picks, plus their history in the same request the Sector
// portfolio tab makes, so it's usually already cached and costs nothing.
async function loadSector() {
  if (cmp.picks) return;
  const r = await fetch("/api/portfolio");
  const p = await r.json().catch(() => null);
  if (!r.ok || !p || p.error) throw new Error((p && p.message) || "Couldn't load the sector portfolio.");
  cmp.picks = p.sectors.flatMap((s) => s.holdings.map((h) => ({ symbol: h.symbol, name: h.name, sector: s.sector })));
  const syms = cmp.picks.map((h) => h.symbol).concat(BENCH);
  try {
    const hr = await fetch("/api/history?symbols=" + encodeURIComponent(syms.join(",")));
    const d = await hr.json().catch(() => null);
    if (d && d.series) {
      for (const [s, pts] of Object.entries(d.series)) {
        if (Array.isArray(pts) && pts.length > 1 && !DATA.series[s]) DATA.series[s] = toSeries(pts, d.meta && d.meta[s]);
      }
    }
  } catch { /* fall back to one symbol at a time below */ }
}

// ---------------------------------------------------------------- picking a portfolio

function fillPicker() {
  const last = getLastLoaded();
  const saved = readSaved();
  const opts = [];
  if (last) opts.push(`<option value="last">Last loaded: ${esc(last.name)}</option>`);
  for (const p of saved) opts.push(`<option value="${esc(p.id)}">${esc(p.name)}</option>`);
  if (!opts.length) {
    $("pickSel").innerHTML = `<option value="">No portfolios yet</option>`;
    $("pickSel").disabled = true;
    $("pickBtn").disabled = true;
    $("msg").innerHTML = `<p class="note">Load or save a portfolio on the Analyze tab, or open a file here.</p>`;
    return;
  }
  $("pickSel").innerHTML = opts.join("");
}

function pickSelected() {
  const v = $("pickSel").value;
  if (v === "last") { const l = getLastLoaded(); if (l) run(l.name, l.holdings); return; }
  const p = readSaved().find((x) => x.id === v);
  if (p) run(p.name, p.holdings);
}

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
        let data;
        try { data = JSON.parse(text); } catch { throw new Error("This file isn't a portfolio file from this site."); }
        const list = (Array.isArray(data.portfolios) ? data.portfolios : [data]).map(cleanPortfolio).filter(Boolean);
        if (!list.length) throw new Error("No portfolios found in this file.");
        run(list[0].name, list[0].holdings,
          list.length > 1 ? `This file has ${list.length} portfolios, so this compares the first one. To choose another, open the file on the Analyze tab, which adds them all to your saved list.` : "");
      } else {
        run(file.name.replace(/\.csv$/i, ""), holdingsFromCSV(text));
      }
    } catch (e) {
      $("msg").innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------- loading

async function run(name, holdings, note = "") {
  $("msg").innerHTML = note ? `<div class="warnbox">${esc(note)}</div>` : "";
  $("results").hidden = true;
  $("pickBtn").disabled = true;
  try {
    $("progress").textContent = "Loading the sector portfolio…";
    await loadSector();
    const want = [...new Set(holdings.filter((h) => !h.isCash).map((h) => h.symbol).concat(cmp.picks.map((p) => p.symbol), BENCH))]
      .filter((s) => !DATA.series[s]);
    if (want.length) {
      await loadAll(
        want,
        (d, n) => ($("progress").textContent = `Loading price history: ${d} of ${n}`),
        (secs, d, n) => ($("progress").innerHTML =
          `Loaded ${d} of ${n}. The free data plans allow only so many requests a minute, so loading continues in ${secs}s. ` +
          `<button type="button" class="ghost" id="stopWait">Compare with what's loaded</button>`)
      );
    }
  } catch (e) {
    $("progress").textContent = "";
    $("pickBtn").disabled = false;
    $("msg").innerHTML += `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  $("progress").textContent = "";
  $("pickBtn").disabled = false;

  const bench = DATA.series[BENCH];
  if (!bench || !bench.map) {
    $("msg").innerHTML += `<div class="error">S&amp;P 500 history couldn't be loaded, so there's nothing to compare against yet. Try again in a few minutes.</div>`;
    return;
  }
  cmp.endK = bench.last;
  cmp.name = name;
  cmp.holdings = holdings.map((h) => {
    const s = DATA.series[h.symbol];
    let value = h.value;
    if (!h.isCash && h.shares != null && s && s.map) value = h.shares * s.lastPrice;
    return { ...h, value };
  }).filter((h) => (h.isCash || (DATA.series[h.symbol] && DATA.series[h.symbol].map)) && h.value > 0);

  const skipped = holdings.filter((h) => !h.isCash && !(DATA.series[h.symbol] && DATA.series[h.symbol].map)).map((h) => h.symbol);
  if (skipped.length) $("msg").innerHTML += `<div class="warnbox">No price history for ${skipped.map(esc).join(", ")}, so ${skipped.length === 1 ? "it is" : "they are"} left out.</div>`;
  if (!cmp.holdings.length) {
    $("msg").innerHTML += `<div class="error">None of this portfolio's holdings have price history yet.</div>`;
    return;
  }
  $("results").hidden = false;
  render();
}

// ---------------------------------------------------------------- math

function pathToRets(path) {
  const r = [];
  for (let i = 1; i < path.length; i++) r.push(path[i] / path[i - 1] - 1);
  return r;
}

// Same rules as the Sector portfolio tab: the 22 picks that were trading at
// the start, drop the 2 worst over the period, equal-weight buy-and-hold.
function sectorFor22(years) {
  const endK = cmp.endK, startK = endK - years * 12;
  const rows = cmp.picks.map((h) => {
    const s = DATA.series[h.symbol];
    if (!s || !s.map || s.first > startK) return { ...h, na: true };
    const p0 = priceAt(s, startK);
    return { ...h, s, p0, r: priceAt(s, endK) / p0 - 1 };
  });
  const elig = rows.filter((r) => !r.na).sort((a, b) => a.r - b.r);
  const held = elig.slice(DROP_COUNT);
  const valuePath = (list) => {
    const out = [];
    for (let k = startK; k <= endK; k++) out.push(list.reduce((a, h) => a + (10000 / list.length) * (priceAt(h.s, k) / h.p0), 0));
    return out;
  };
  return {
    strat: stats(pathToRets(valuePath(held))),
    all: stats(pathToRets(valuePath(elig))),
    dropped: elig.slice(0, DROP_COUNT).map((h) => h.symbol),
    missing: rows.filter((r) => r.na).map((r) => r.symbol),
    held: held.length,
  };
}

function periodData(years) {
  const endK = cmp.endK, startK = endK - years * 12;
  const yours = weightedReturns(cmp.holdings, startK, endK);
  const brets = [];
  for (let k = startK + 1; k <= endK; k++) brets.push(ret(DATA.series[BENCH], k) ?? 0);
  const sec = sectorFor22(years);
  return { years, startK, endK, yours: stats(yours.rets), coverage: yours.coverage, sector: sec.strat, all: sec.all, bench: stats(brets), sec };
}

// ---------------------------------------------------------------- render

function render() {
  const all = PERIODS.map(periodData);
  const cur = all.find((d) => d.years === cmp.years);
  const cols = [["yours", cmp.name], ["sector", "Sector portfolio"], ["all", "All 22 sector stocks"], ["bench", "S&P 500 (SPY)"]];

  $("headline").textContent =
    `Over the last ${periodLabel(cur.years)}, ${cmp.name} returned ${pct(cur.yours.cagr, 1, false)} a year, ` +
    `compared with ${pct(cur.sector.cagr, 1, false)} for the sector portfolio and ${pct(cur.bench.cagr, 1, false)} for the S&P 500.`;

  $("retTable").innerHTML = `
    <thead><tr><th>Period</th>${cols.map(([, h]) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${all.map((d) => `<tr data-y="${d.years}" class="${d.years === cmp.years ? "current" : ""}">
      <td>${periodLabel(d.years)}${d.coverage < 0.95 ? " *" : ""}</td>
      ${cols.map(([k]) => `<td class="num"><span class="${cls(d[k].cagr)}">${pct(d[k].cagr)}</span><span class="cell-sub">${pct(d[k].total, 0)} total</span></td>`).join("")}
    </tr>`).join("")}</tbody>`;
  const low = all.filter((d) => d.coverage < 0.95);
  $("retNote").textContent = (low.length
    ? `* Some of ${cmp.name}'s holdings weren't trading at the start of the ${low.map((d) => d.years + "-").join(", ").replace(/, ([^,]*)$/, " and $1")}year period${low.length > 1 ? "s" : ""}; only ${pct(low[low.length - 1].coverage, 0, false)} of today's value had history ${low[low.length - 1].years} years ago, so those periods reflect the holdings that did. `
    : "") + "Click a row to chart that period.";

  // Growth chart for the chosen period
  const labels = [];
  for (let k = cur.startK; k <= cur.endK; k++) labels.push(keyLabel(k));
  lineChart("growthChart", labels, [
    line(cmp.name, cur.yours.path, COL.yours),
    line("Sector portfolio", cur.sector.path, COL.sector),
    line("All 22 sector stocks", cur.all.path, COL.all, { borderWidth: 1.5, borderDash: [2, 3] }),
    line("S&P 500 (SPY)", cur.bench.path, COL.bench, { borderWidth: 1.5, borderDash: [6, 4] }),
  ], (v) => usd(v));
  $("growthLegend").innerHTML = legend([
    [cmp.name, COL.yours], ["Sector portfolio", COL.sector], ["All 22 sector stocks (dotted)", COL.all, true], ["S&P 500 (dashed)", COL.bench, true],
  ]);
  const s = cur.sec;
  $("periodNote").textContent = `${keyLabel(cur.startK)} to ${keyLabel(cur.endK)}. The sector portfolio dropped ${s.dropped.join(" and ")}` +
    (s.missing.length ? `; ${s.missing.map((m) => `${m} (${START_NOTES[m] || "trading since " + keyLabel(DATA.series[m] ? DATA.series[m].first : cur.startK)})`).join(", ")} ${s.missing.length === 1 ? "has" : "have"} no price history that far back, so it held ${s.held}.` : ".");

  const row = (label, f, c) => `<tr><td>${label}</td>${cols.map(([k]) => `<td class="num ${c ? cls(c(cur[k])) : ""}">${f(cur[k])}</td>`).join("")}</tr>`;
  $("riskTable").innerHTML = `
    <thead><tr><th>${esc(periodLabel(cur.years))}</th>${cols.map(([, h]) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("$10,000 became", (x) => usd(x.end))}
      ${row("Total return", (x) => pct(x.total), (x) => x.total)}
      ${row("Per year", (x) => pct(x.cagr), (x) => x.cagr)}
      ${row("Volatility (annual)", (x) => pct(x.vol, 1, false))}
      ${row("Worst drop", (x) => pct(x.mdd), (x) => x.mdd)}
    </tbody>`;

  renderMix();
}

function renderMix() {
  const total = cmp.holdings.reduce((a, h) => a + h.value, 0);
  const yours = {}, sector = {};
  for (const h of cmp.holdings) { const k = sectorFor(h); yours[k] = (yours[k] || 0) + h.value / total; }
  for (const p of cmp.picks) sector[p.sector] = (sector[p.sector] || 0) + 1 / cmp.picks.length;
  const cats = [...new Set([...Object.keys(yours), ...Object.keys(sector)])]
    .sort((a, b) => (yours[b] || 0) - (yours[a] || 0) || (sector[b] || 0) - (sector[a] || 0));
  $("mixBox").style.height = cats.length * 38 + 40 + "px";
  if (CHARTS.mixChart) CHARTS.mixChart.destroy();
  const bar = (label, vals, color) => ({ label, data: cats.map((c) => (vals[c] || 0) * 100), backgroundColor: color, borderRadius: 3, borderSkipped: "start", barThickness: 12, categoryPercentage: 0.8, barPercentage: 0.9 });
  CHARTS.mixChart = new Chart($("mixChart"), {
    type: "bar",
    data: { labels: cats, datasets: [bar(cmp.name, yours, COL.yours), bar("Sector portfolio", sector, COL.sector)] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.x.toFixed(1)}%` } } },
      scales: {
        x: { beginAtZero: true, grid: { color: "#E6EBF0" }, border: { display: false }, ticks: { color: "#52606D", font: { family: "Instrument Sans" }, callback: (v) => v + "%" } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: "#102A43", font: { family: "Instrument Sans", size: 13 } } },
      },
    },
  });
  $("mixLegend").innerHTML = legend([[cmp.name, COL.yours], ["Sector portfolio (today's 22 stocks, equal weight)", COL.sector]]);
}

// ---------------------------------------------------------------- wiring

function setYears(y) {
  cmp.years = y;
  $("periodSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.y) === y)));
  if (cmp.endK) render();
}

$("periodSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setYears(Number(b.dataset.y))));
$("retTable").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-y]"); if (tr) setYears(Number(tr.dataset.y)); });
$("pickBtn").addEventListener("click", pickSelected);
$("progress").addEventListener("click", (e) => { if (e.target.id === "stopWait") DATA.stopWaiting = true; });
const drop = $("drop");
drop.addEventListener("click", () => $("file").click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer.files[0]); });
$("file").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });

fillPicker();
// Coming straight from the Analyze tab: compare what was just loaded.
if (getLastLoaded() && new URLSearchParams(location.search).get("auto") !== "0") pickSelected();
