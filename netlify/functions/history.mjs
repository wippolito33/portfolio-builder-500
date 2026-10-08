// GET /api/history?symbols=AAPL,MSFT,...
// Returns ~21 years of monthly adjusted-close prices for each symbol, enough
// for 1- to 20-year backtests. Prices come from the saved copies in
// ../lib/historyStore.mjs; a data provider is only called for a stock that
// hasn't been saved yet or whose saved copy is more than 20 hours old.
//
// Response:
//   series: { SYM: [{t, p}, ...] | { error, rateLimited } }
//   meta:   { SYM: { source, adjusted, fetchedAt } }
import { json } from "../lib/tiingo.mjs";
import { getSeries } from "../lib/historyStore.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s))
    .slice(0, 40);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400);

  const results = await Promise.all(symbols.map(async (s) => [s, await getSeries(s)]));

  const series = {}, meta = {};
  let failed = 0, limited = false;
  for (const [s, r] of results) {
    if (r.points) {
      series[s] = r.points;
      meta[s] = { source: r.source, adjusted: r.adjusted, fetchedAt: r.fetchedAt };
    } else {
      failed++;
      limited = limited || !!r.rateLimited;
      series[s] = { error: r.error, rateLimited: !!r.rateLimited };
    }
  }

  if (failed === results.length) {
    // Nothing came back. Don't cache this, so a retry can succeed.
    return json({ error: limited ? "RATE_LIMITED" : "HISTORY_FAILED", message: results[0][1].error, rateLimited: limited, series }, limited ? 429 : 502);
  }
  // Saved copies refresh daily, so the CDN can hold a full answer for 6 hours.
  // A partial answer is held for only 10 minutes so missing stocks get retried.
  return json({ asOf: new Date().toISOString(), series, meta }, 200, failed ? 600 : 6 * 3600);
};

export const config = { path: "/api/history" };
