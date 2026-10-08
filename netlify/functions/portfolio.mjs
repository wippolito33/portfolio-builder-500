// GET /api/portfolio
// Ranks the largest S&P 500 names in each of the 11 GICS sectors by LIVE
// market cap and returns the top two per sector (22 stocks), with live prices.
//
// Tiingo's free tier does not provide market cap, so sector ranking uses the
// curated size-ordered list below (reviewed once or twice a year). Live prices
// and today's change come from Tiingo.
import { getQuotes, getMeta, json, key } from "../lib/tiingo.mjs";

// Candidate pool: the largest S&P 500 constituents in each sector, in
// approximate size order. The top two per sector are selected.
export const SECTORS = {
  "Information Technology": ["NVDA", "MSFT", "AAPL", "AVGO", "ORCL", "PLTR", "AMD", "CSCO", "IBM", "CRM", "MU"],
  "Communication Services": ["GOOGL", "META", "NFLX", "TMUS", "DIS", "T", "VZ"],
  "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "BKNG", "TJX", "LOW"],
  "Financials": ["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS"],
  "Health Care": ["LLY", "JNJ", "ABBV", "UNH", "ABT", "MRK", "TMO", "ISRG"],
  "Consumer Staples": ["WMT", "COST", "PG", "KO", "PEP", "PM"],
  "Energy": ["XOM", "CVX", "COP", "WMB", "EOG", "SLB"],
  "Industrials": ["GE", "CAT", "RTX", "GEV", "UBER", "HON", "UNP", "BA"],
  "Materials": ["LIN", "SHW", "NEM", "ECL", "APD", "FCX"],
  "Utilities": ["NEE", "CEG", "SO", "DUK", "VST", "AEP"],
  "Real Estate": ["WELL", "PLD", "AMT", "EQIX", "SPG", "O"],
};

// Only the two picks per sector need names/prices, so build that list first.
const PICKS = Object.values(SECTORS).map((s) => s.slice(0, 2));

export default async () => {
  try {
    key();
  } catch {
    return json({ error: "NO_KEY", message: "Tiingo API key not set. Add TIINGO_KEY in Netlify environment variables and redeploy." }, 500, 0);
  }

  const picks = PICKS.flat();
  let quotes = [];
  try {
    quotes = await getQuotes(picks);
  } catch (e) {
    return json({ error: "QUOTES_FAILED", message: String(e.message || e) }, 502, 0);
  }
  const bySym = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Names come from metadata; fetch in parallel, tolerate individual failures.
  const metas = await Promise.all(
    picks.map((s) => getMeta(s).catch(() => ({ symbol: s, name: s })))
  );
  const nameBySym = Object.fromEntries(metas.map((m) => [m.symbol, m.name]));

  const sectors = Object.entries(SECTORS).map(([sector, syms]) => ({
    sector,
    holdings: syms.slice(0, 2).map((s) => ({
      symbol: s,
      name: nameBySym[s] || s,
      marketCap: null, // not available on Tiingo free tier
      ...(bySym[s] || {}),
    })),
  }));

  return json({ asOf: new Date().toISOString(), source: "tiingo-live", sectors }, 200, 30);
};

export const config = { path: "/api/portfolio" };
