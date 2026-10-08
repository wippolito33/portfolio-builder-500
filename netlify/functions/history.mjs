// GET /api/history?symbols=AAPL,MSFT,...
// Returns ~21 years of monthly adjusted-close prices (dividends + splits
// reinvested) for each symbol, enough for 5/10/20-year backtests.
//
// Sources, in order:
//   1. Tiingo       (free: 50 requests/hour, dividend-adjusted)
//   2. Twelve Data  (free: 8 requests/minute, 800/day) once Tiingo is limited
//
// Response:
//   series: { SYM: [{t, p}, ...] | { error, rateLimited } }
//   meta:   { SYM: { source, adjusted } }
import { getHistory, json } from "../lib/tiingo.mjs";
import { getHistoryTD, tdKey } from "../lib/twelvedata.mjs";

// While this function instance stays warm, skip a provider that just said
// "slow down" instead of asking it again for every symbol.
const coolUntil = { tiingo: 0, twelvedata: 0 };

async function fetchOne(sym, startDate) {
  const errors = [];
  let limited = false;
  const now = Date.now();

  if (process.env.TIINGO_KEY) {
    if (now < coolUntil.tiingo) {
      limited = true;
    } else {
      try {
        const points = await getHistory(sym, startDate);
        if (points.length >= 2) return { points, source: "tiingo", adjusted: true };
        errors.push("Tiingo: no price history");
      } catch (e) {
        if (e.status === 429) { coolUntil.tiingo = now + 10 * 60 * 1000; limited = true; }
        errors.push(e.message);
      }
    }
  }

  if (tdKey()) {
    if (Date.now() < coolUntil.twelvedata) {
      limited = true;
    } else {
      try {
        const r = await getHistoryTD(sym, startDate);
        return { ...r, source: "twelvedata" };
      } catch (e) {
        if (e.status === 429) { coolUntil.twelvedata = Date.now() + 60 * 1000; limited = true; }
        errors.push(e.message);
      }
    }
  }

  if (!process.env.TIINGO_KEY && !tdKey()) errors.push("No data provider key is set in Netlify.");
  return { error: errors.join(" | ") || "Data provider limits reached", rateLimited: limited };
}

export default async (req) => {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s))
    .slice(0, 40);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400);

  const start = new Date();
  start.setFullYear(start.getFullYear() - 21);
  const startDate = start.toISOString().slice(0, 10);

  const results = await Promise.all(symbols.map(async (s) => [s, await fetchOne(s, startDate)]));

  const series = {}, meta = {};
  let failed = 0, limited = false;
  for (const [s, r] of results) {
    if (r.points) {
      series[s] = r.points;
      meta[s] = { source: r.source, adjusted: r.adjusted };
    } else {
      failed++;
      limited = limited || r.rateLimited;
      series[s] = { error: r.error, rateLimited: r.rateLimited };
    }
  }

  if (failed === results.length) {
    // Nothing came back. Don't cache this, so a retry can succeed.
    const first = results[0][1];
    return json({ error: limited ? "RATE_LIMITED" : "HISTORY_FAILED", message: first.error, rateLimited: limited, series }, limited ? 429 : 502);
  }
  // Monthly history barely changes: cache a full result for 24 hours. A partial
  // result is cached for only 10 minutes so the missing stocks get retried.
  return json({ asOf: new Date().toISOString(), series, meta }, 200, failed ? 600 : 86400);
};

export const config = { path: "/api/history" };
