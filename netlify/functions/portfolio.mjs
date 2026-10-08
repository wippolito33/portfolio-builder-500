// GET /api/portfolio
// Ranks the largest S&P 500 names in each of the 11 GICS sectors by LIVE
// market cap and returns the top two per sector (22 stocks), with live prices.
import { getQuotes, getChart, json } from "../lib/yahoo.mjs";

// Candidate pool: the largest S&P 500 constituents in each sector.
// Listed in approximate size order, which is only used as a fallback if
// Yahoo's market-cap feed is unavailable. Review once or twice a year.
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

export default async () => {
  const all = Object.values(SECTORS).flat();
  let quotes = null;
  let source = "yahoo-live";
  try {
    quotes = await getQuotes(all);
  } catch (e) {
    source = "fallback-order"; // market cap unavailable; use list order
  }
  const bySym = Object.fromEntries((quotes || []).map((q) => [q.symbol, q]));

  const sectors = [];
  for (const [sector, syms] of Object.entries(SECTORS)) {
    let ranked = syms.map((s, i) => ({ symbol: s, rank: i, ...(bySym[s] || {}) }));
    if (source === "yahoo-live" && ranked.every((r) => r.marketCap)) {
      ranked.sort((a, b) => b.marketCap - a.marketCap);
    } else if (source === "yahoo-live") {
      source = "partial";
      ranked.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0) || a.rank - b.rank);
    }
    sectors.push({ sector, holdings: ranked.slice(0, 2) });
  }

  // If the quote feed failed entirely, still fetch prices via the chart endpoint.
  if (!quotes) {
    const picks = sectors.flatMap((s) => s.holdings);
    await Promise.all(
      picks.map(async (h) => {
        try {
          const c = await getChart(h.symbol, { period1: Math.floor(Date.now() / 1000) - 10 * 86400, interval: "1d" });
          h.name = c.meta.name;
          h.price = c.meta.price;
          if (c.meta.price && c.meta.prevClose) {
            h.change = c.meta.price - c.meta.prevClose;
            h.changePct = (h.change / c.meta.prevClose) * 100;
          }
        } catch {}
      })
    );
  }

  return json({ asOf: new Date().toISOString(), source, sectors }, 200, 30);
};

export const config = { path: "/api/portfolio" };
