// GET /api/portfolio
// Returns the 22 holdings (the two largest S&P 500 stocks in each of the 11
// sectors) with live prices from Tiingo.
//
// Uses ONE Tiingo request per call, and the result is cached on Netlify's CDN
// for 5 minutes, so Tiingo is hit at most ~12 times an hour no matter how many
// times the page is opened or refreshed.
import { getQuotes, json, key } from "../lib/tiingo.mjs";
import { SECTORS } from "../lib/sectors.mjs";

const QUOTE_CACHE_SECONDS = 300; // 5 minutes


export default async () => {
  try {
    key();
  } catch {
    return json({ error: "NO_KEY", message: "Tiingo API key not set. Add TIINGO_KEY in Netlify environment variables and redeploy." }, 500);
  }

  const symbols = Object.values(SECTORS).flat().map(([s]) => s);

  // Prices are nice to have; the backtest still works without them.
  let bySym = {};
  let quotesError = null;
  try {
    const quotes = await getQuotes(symbols);
    bySym = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
  } catch (e) {
    quotesError = String(e.message || e);
  }

  const sectors = Object.entries(SECTORS).map(([sector, list]) => ({
    sector,
    holdings: list.map(([symbol, name]) => ({ symbol, name, ...(bySym[symbol] || {}) })),
  }));

  return json(
    { asOf: new Date().toISOString(), source: "tiingo", quotesError, sectors },
    200,
    // Cache a failed quote pull briefly too, so a rate-limit doesn't get
    // hammered by repeated refreshes.
    quotesError ? 120 : QUOTE_CACHE_SECONDS
  );
};

export const config = { path: "/api/portfolio" };
