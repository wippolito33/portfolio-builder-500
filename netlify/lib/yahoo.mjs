// Shared helpers for talking to Yahoo Finance from Netlify Functions.
// Yahoo blocks direct browser calls (CORS), so the site calls these
// functions and they call Yahoo server-side.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let session = null; // { cookie, crumb, at }

export async function getSession(force = false) {
  if (!force && session && Date.now() - session.at < 30 * 60 * 1000) return session;
  const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  const raw = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  const cookie = raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("No Yahoo cookie");
  const c = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.includes("<")) throw new Error("No Yahoo crumb");
  session = { cookie, crumb, at: Date.now() };
  return session;
}

// Batch quote with market cap (needs cookie + crumb).
export async function getQuotes(symbols) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(attempt > 0);
    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
      encodeURIComponent(symbols.join(",")) +
      "&crumb=" + encodeURIComponent(s.crumb);
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: s.cookie } });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error("Quote HTTP " + r.status);
    const j = await r.json();
    return (j.quoteResponse?.result || []).map((q) => ({
      symbol: q.symbol,
      name: q.longName || q.shortName || q.symbol,
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      marketCap: q.marketCap ?? null,
      marketState: q.marketState ?? null,
    }));
  }
  throw new Error("Quote auth failed");
}

// Price history (no crumb needed). Returns [{t, p}] using adjusted close
// so dividends and splits are included in returns.
export async function getChart(symbol, { period1, period2 = Math.floor(Date.now() / 1000), interval = "1mo" } = {}) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${interval}&events=div%2Csplit&includeAdjustedClose=true`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`Chart ${symbol} HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart?.result?.[0];
  if (!res) throw new Error(`Chart ${symbol}: no data`);
  const ts = res.timestamp || [];
  const adj = res.indicators?.adjclose?.[0]?.adjclose || res.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) if (adj[i] != null) points.push({ t: ts[i] * 1000, p: adj[i] });
  return { symbol, points, meta: { price: res.meta?.regularMarketPrice ?? null, prevClose: res.meta?.chartPreviousClose ?? null, name: res.meta?.longName || res.meta?.shortName || symbol } };
}

export function json(body, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
  });
}
