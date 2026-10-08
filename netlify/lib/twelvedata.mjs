// Helpers for Twelve Data (https://twelvedata.com), used as a backup source of
// monthly price history when Tiingo's hourly limit is reached.
//
// The API key is read from a Netlify environment variable (TWELVEDATA_KEY;
// a few common spellings are accepted). It is never committed to the repo.
//
// Free plan: 8 credits a minute, 800 a day. Each symbol costs 1 credit, even
// in a batch, so history is fetched one symbol at a time.

const BASE = "https://api.twelvedata.com";

export function tdKey() {
  return (
    process.env.TWELVEDATA_KEY ||
    process.env.TWELVE_DATA_KEY ||
    process.env.TWELVEDATA_API_KEY ||
    process.env.TWELVE_DATA_API_KEY ||
    null
  );
}

// Twelve Data uses a dot for share classes (BRK.B).
const toTwelve = (s) => s.replace("-", ".");

function fail(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function timeSeries(symbol, startDate, adjust) {
  const params = new URLSearchParams({
    symbol: toTwelve(symbol),
    interval: "1month",
    start_date: startDate,
    outputsize: "5000",
    order: "asc",
    apikey: tdKey(),
  });
  if (adjust) params.set("adjust", adjust);
  const r = await fetch(`${BASE}/time_series?${params}`);
  const j = await r.json().catch(() => null);
  if (!j) throw fail(`Twelve Data HTTP ${r.status}`, r.status);
  // Errors can arrive with HTTP 200 and status "error" in the body.
  if (j.status === "error" || (j.code && j.code >= 400)) {
    throw fail(`Twelve Data ${j.code || r.status}: ${j.message || "error"}`, Number(j.code) || r.status);
  }
  return j;
}

// Monthly history as [{ t, p }], oldest first. Asks for prices adjusted for
// splits AND dividends; if the plan refuses that, falls back to split-only
// prices and reports adjusted: false so the page can flag it.
export async function getHistoryTD(symbol, startDate) {
  let adjusted = true;
  let j;
  try {
    j = await timeSeries(symbol, startDate, "all");
  } catch (e) {
    const planIssue = e.status === 403 || /adjust|plan|upgrade|premium|subscription/i.test(e.message);
    if (e.status === 429 || !planIssue) throw e;
    adjusted = false;
    j = await timeSeries(symbol, startDate, null);
  }
  const points = (j.values || [])
    .map((v) => ({ t: Date.parse(String(v.datetime).slice(0, 10) + "T00:00:00Z"), p: parseFloat(v.close) }))
    .filter((x) => isFinite(x.t) && isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) throw fail("Twelve Data: no price history", 404);
  return { points, adjusted };
}
