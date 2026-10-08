// GET /api/history?symbols=AAPL,MSFT,...
// Returns ~21 years of monthly adjusted-close prices (dividends + splits
// reinvested) for each symbol, from Tiingo, enough for 5/10/20-year backtests.
import { getHistory, json, key } from "../lib/tiingo.mjs";

export default async (req) => {
  try {
    key();
  } catch {
    return json({ error: "NO_KEY", message: "Tiingo API key not set. Add TIINGO_KEY in Netlify environment variables and redeploy." }, 500, 0);
  }

  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,10}$/.test(s))
    .slice(0, 40);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400, 0);

  const start = new Date();
  start.setFullYear(start.getFullYear() - 21);
  const startDate = start.toISOString().slice(0, 10);

  const results = await Promise.all(
    symbols.map(async (s) => {
      try {
        return [s, await getHistory(s, startDate)];
      } catch (e) {
        return [s, { error: String(e.message || e) }];
      }
    })
  );
  return json({ asOf: new Date().toISOString(), series: Object.fromEntries(results) }, 200, 21600);
};

export const config = { path: "/api/history" };
