// Shared helpers for Tiingo (https://www.tiingo.com).
// The API key is read from the TIINGO_KEY environment variable set in
// Netlify (Site configuration -> Environment variables). It is never
// committed to the repo.

const BASE = "https://api.tiingo.com";

export function key() {
  const k = process.env.TIINGO_KEY;
  if (!k) throw new Error("NO_KEY");
  return k;
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set("token", key());
  const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const e = new Error(`Tiingo HTTP ${r.status}${body ? ": " + body.slice(0, 120) : ""}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// Tiingo uses a dot for class shares (BRK.B), unlike Yahoo's dash (BRK-B).
export const toTiingo = (s) => s.replace("-", ".");

// Live-ish quote via the IEX endpoint: price + previous close.
export async function getQuotes(symbols) {
  const map = Object.fromEntries(symbols.map((s) => [toTiingo(s), s]));
  const data = await get("/iex", { tickers: Object.keys(map).join(",") });
  return (data || []).map((q) => {
    const orig = map[(q.ticker || "").toUpperCase()] || q.ticker;
    const price = q.last ?? q.tngoLast ?? q.prevClose ?? null;
    const prev = q.prevClose ?? null;
    return {
      symbol: orig,
      price,
      prevClose: prev,
      change: price != null && prev != null ? price - prev : null,
      changePct: price != null && prev != null && prev ? ((price - prev) / prev) * 100 : null,
    };
  });
}

// Monthly adjusted close (dividends + splits reinvested) for backtests.
export async function getHistory(symbol, startDate) {
  const rows = await get(`/tiingo/daily/${toTiingo(symbol)}/prices`, {
    startDate,
    resampleFreq: "monthly",
    columns: "date,adjClose",
  });
  return (rows || [])
    .filter((r) => r.adjClose != null)
    .map((r) => ({ t: Date.parse(r.date), p: r.adjClose }));
}

// Tiingo's free plan allows 50 requests/hour and 1,000/day, so responses are
// cached on Netlify's CDN ("durable" = shared across all edge locations).
// While a cached copy is fresh, Tiingo is not called at all.
// cdnSeconds = 0 means "don't cache" (used for errors).
export function json(body, status = 200, cdnSeconds = 0) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=0, must-revalidate" };
  if (status === 200 && cdnSeconds > 0) {
    headers["Netlify-CDN-Cache-Control"] =
      `public, durable, s-maxage=${cdnSeconds}, stale-while-revalidate=${cdnSeconds * 2}`;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
