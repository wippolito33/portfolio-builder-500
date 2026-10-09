// GET /api/quotes?symbols=AAPL,VEA,...
// Latest prices and previous close from Tiingo for up to 40 symbols, in ONE
// Tiingo request. Cached on Netlify's CDN for 15 minutes, so opening or
// refreshing the page doesn't use up the free plan.
import { getQuotes, json, key } from "../lib/tiingo.mjs";

const CACHE_SECONDS = 900;

export default async (req) => {
  const symbols = (new URL(req.url).searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s))
    .slice(0, 40);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400);
  try {
    key();
  } catch {
    return json({ error: "NO_KEY", message: "Tiingo API key not set." }, 500);
  }
  try {
    const quotes = await getQuotes(symbols);
    return json({ asOf: new Date().toISOString(), quotes: Object.fromEntries(quotes.map((q) => [q.symbol, q])) }, 200, CACHE_SECONDS);
  } catch (e) {
    return json({ error: "QUOTES_FAILED", message: String(e.message || e) }, e.status === 429 ? 429 : 502);
  }
};

export const config = { path: "/api/quotes" };
