// Market capitalization for individual stocks, used by the Am I Diversified?
// page to split U.S. stocks into large, mid and small cap.
//
// Providers, in order:
//   1. Tiingo fundamentals (/tiingo/fundamentals/{t}/daily -> marketCap).
//      Tiingo's free plan only includes fundamentals for a small sample of
//      large companies; the fundamentals add-on covers the rest.
//   2. Twelve Data statistics (/statistics -> market_capitalization).
//      Not included in Twelve Data's free plan.
// When a provider says the plan doesn't include the data, it is skipped for
// 24 hours so the free request limits aren't spent asking again.
//
// Results are saved in Netlify Blobs (store "market-cap"): a found value for
// 7 days, "not available" for 3 days.
import { getStore } from "@netlify/blobs";
import { key as tiingoKey, toTiingo } from "./tiingo.mjs";
import { tdKey } from "./twelvedata.mjs";

const FOUND_MS = 7 * 24 * 3600 * 1000;
const MISS_MS = 3 * 24 * 3600 * 1000;
const PLAN_SKIP_MS = 24 * 3600 * 1000;
const STATUS_KEY = "_providers";

let store;
function blobStore() {
  if (store === undefined) {
    try { store = getStore("market-cap"); } catch { store = false; }
  }
  return store;
}
async function readJSON(k) {
  const s = blobStore();
  if (!s) return null;
  try { return await s.get(k, { type: "json" }); } catch { return null; }
}
async function writeJSON(k, v) {
  const s = blobStore();
  if (!s) return;
  try { await s.setJSON(k, v); } catch { /* still works without saving */ }
}

const planIssue = (status, msg) =>
  status === 401 || status === 403 || /plan|upgrade|premium|subscription|permission|not available|not authorized|DOW 30/i.test(msg || "");

async function fromTiingo(sym) {
  const start = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = new URL(`https://api.tiingo.com/tiingo/fundamentals/${toTiingo(sym)}/daily`);
  url.searchParams.set("startDate", start);
  url.searchParams.set("token", tiingoKey());
  const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`Tiingo ${r.status}: ${text.slice(0, 120)}`); e.status = r.status; throw e; }
  let rows; try { rows = JSON.parse(text); } catch { rows = null; }
  if (!Array.isArray(rows)) { const e = new Error(`Tiingo: ${text.slice(0, 120)}`); e.status = 403; throw e; }
  const last = rows.filter((x) => x && x.marketCap > 0).pop();
  return last ? last.marketCap : null;
}

async function fromTwelve(sym) {
  const params = new URLSearchParams({ symbol: sym.replace("-", "."), apikey: tdKey() });
  const r = await fetch(`https://api.twelvedata.com/statistics?${params}`);
  const j = await r.json().catch(() => null);
  if (!j) { const e = new Error(`Twelve Data HTTP ${r.status}`); e.status = r.status; throw e; }
  if (j.status === "error" || (j.code && j.code >= 400)) { const e = new Error(`Twelve Data ${j.code}: ${j.message || ""}`); e.status = Number(j.code) || r.status; throw e; }
  const v = j.statistics && j.statistics.valuations_metrics && Number(j.statistics.valuations_metrics.market_capitalization);
  return v > 0 ? v : null;
}

// Returns { SYM: { cap, source, fetchedAt } | { cap: null, reason } } and
// whether any provider is set up to supply caps at all.
export async function getMarketCaps(symbols) {
  const status = (await readJSON(STATUS_KEY)) || {};
  const now = Date.now();
  const providers = [];
  try { tiingoKey(); providers.push(["tiingo", fromTiingo]); } catch {}
  if (tdKey()) providers.push(["twelvedata", fromTwelve]);
  const usable = () => providers.filter(([n]) => !(status[n] && status[n].skipUntil > now));

  const out = {};
  let statusChanged = false;
  async function one(sym) {
    const saved = await readJSON("cap:" + sym);
    if (saved && now - saved.fetchedAt < (saved.cap ? FOUND_MS : MISS_MS)) { out[sym] = saved; return; }
    let cap = null, source = null, limited = false;
    for (const [name, fn] of usable()) {
      try {
        cap = await fn(sym);
        if (cap) { source = name; break; }
      } catch (e) {
        if (e.status === 429) { limited = true; continue; }
        if (planIssue(e.status, e.message)) { status[name] = { skipUntil: now + PLAN_SKIP_MS, note: String(e.message).slice(0, 160) }; statusChanged = true; }
      }
    }
    if (cap) {
      out[sym] = { cap, source, fetchedAt: now };
      await writeJSON("cap:" + sym, out[sym]);
    } else if (saved && saved.cap) {
      out[sym] = saved; // an older value beats none for a size bucket
    } else {
      out[sym] = { cap: null, reason: limited ? "limit" : usable().length ? "none" : "plan", fetchedAt: now };
      if (!limited && usable().length) await writeJSON("cap:" + sym, out[sym]);
    }
  }
  // A few at a time, so a long list finishes well inside the function time limit.
  const queue = [...symbols];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
  if (statusChanged) await writeJSON(STATUS_KEY, status);
  return { caps: out, available: usable().length > 0 };
}
