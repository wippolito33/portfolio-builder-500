// GET /api/marketcap?symbols=AAPL,PAYC,...
// Market capitalization for up to 20 stocks (see ../lib/marketCap.mjs).
// Response: { caps: { SYM: { cap, source } | { cap: null, reason } }, available }
import { json } from "../lib/tiingo.mjs";
import { getMarketCaps } from "../lib/marketCap.mjs";

export default async (req) => {
  const symbols = [...new Set((new URL(req.url).searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s)))]
    .slice(0, 20);
  if (!symbols.length) return json({ error: "Pass ?symbols=AAA,BBB" }, 400);
  try {
    const r = await getMarketCaps(symbols);
    const complete = Object.values(r.caps).every((c) => c.cap || c.reason !== "limit");
    return json({ asOf: new Date().toISOString(), ...r }, 200, complete ? 6 * 3600 : 300);
  } catch (e) {
    return json({ error: "MARKETCAP_FAILED", message: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/marketcap" };
