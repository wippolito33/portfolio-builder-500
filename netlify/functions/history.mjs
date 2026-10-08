// GET /api/history?symbols=AAPL,MSFT,...
// Returns ~21 years of monthly adjusted-close prices (dividends + splits
// reinvested) for each symbol, enough to run 5, 10 and 20-year backtests.
import { getChart, json } from "../lib/yahoo.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-^]{1,10}$/.test(s))
    .slice(0, 40);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400, 0);

  const period1 = Math.floor(Date.now() / 1000) - Math.round(21 * 365.25 * 86400);
  const results = await Promise.all(
    symbols.map(async (s) => {
      try {
        const c = await getChart(s, { period1, interval: "1mo" });
        return [s, c.points];
      } catch (e) {
        return [s, { error: String(e.message || e) }];
      }
    })
  );
  // History changes slowly; cache for 6 hours at the edge.
  return json({ asOf: new Date().toISOString(), series: Object.fromEntries(results) }, 200, 21600);
};

export const config = { path: "/api/history" };
