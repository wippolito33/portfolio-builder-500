// Saved price history.
//
// The site only needs end-of-day prices, so each stock's monthly history is
// saved in Netlify Blobs (storage built into Netlify) and reused. A stock is
// downloaded from a data provider the first time anyone asks for it, then
// refreshed at most once every 20 hours. If a refresh hits a provider's limit,
// the saved copy is served instead, so the free plans' limits only matter for
// stocks the site has never seen before.
//
// Providers, in order:
//   1. Tiingo       (free: 50 requests/hour, dividend-adjusted)
//   2. Twelve Data  (free: 8 requests/minute, 800/day)
import { getStore } from "@netlify/blobs";
import { getHistory } from "./tiingo.mjs";
import { getHistoryTD, tdKey } from "./twelvedata.mjs";

export const FRESH_MS = 20 * 60 * 60 * 1000;

// Stocks whose ticker began with a merger, so their earlier history lives
// under the predecessor's ticker. The predecessor's monthly returns are
// joined on before the first month of the current ticker.
//   LIN: Linde plc was formed on 31 Oct 2018 from Praxair (PX) and Linde AG;
//        each Praxair share became one Linde plc share.
// (Spin-offs such as CEG from Exelon are NOT listed: the parent company is a
// different business, so there is no earlier history to join.)
export const PREDECESSORS = {
  LIN: { symbol: "PX", note: "Praxair (PX) before the Oct 2018 Linde merger" },
};
const RETRY_CHAIN_MS = 7 * 24 * 60 * 60 * 1000;

const monthOf = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

// Joins predecessor history onto the front of a series, scaled so returns
// carry straight through the changeover month.
export function chainHistory(points, prePoints) {
  if (!points.length || !prePoints.length) return null;
  const firstK = monthOf(points[0].t);
  const before = prePoints.filter((p) => monthOf(p.t) < firstK);
  const at = prePoints.filter((p) => monthOf(p.t) <= firstK).pop();
  if (!before.length || !at || firstK - monthOf(at.t) > 2) return null;
  const scale = points[0].p / at.p;
  return [...before.map((p) => ({ t: p.t, p: p.p * scale })), ...points];
}

let store; // undefined = not tried yet, false = unavailable (e.g. local tests)
function blobStore() {
  if (store === undefined) {
    try { store = getStore("price-history"); } catch { store = false; }
  }
  return store;
}
export function _setStoreForTests(s) { store = s; }

const keyFor = (sym) => sym.toUpperCase().replace(/[^A-Z0-9.\-]/g, "");

export async function readStored(sym) {
  const s = blobStore();
  if (!s) return null;
  try {
    const rec = await s.get(keyFor(sym), { type: "json" });
    return rec && Array.isArray(rec.points) && rec.points.length > 1 ? rec : null;
  } catch { return null; }
}

async function writeStored(sym, rec) {
  const s = blobStore();
  if (!s) return;
  try { await s.setJSON(keyFor(sym), rec); } catch { /* serving still works without saving */ }
}

export async function listStored() {
  const s = blobStore();
  if (!s) return [];
  try { const { blobs } = await s.list(); return blobs.map((b) => b.key); } catch { return []; }
}

export function historyStartDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 21);
  return d.toISOString().slice(0, 10);
}

// While a function instance stays warm, skip a provider that just said
// "slow down" instead of asking it again for every symbol.
const coolUntil = { tiingo: 0, twelvedata: 0 };

async function fetchFromProviders(sym) {
  const startDate = historyStartDate();
  const errors = [];
  let limited = false;

  if (process.env.TIINGO_KEY) {
    if (Date.now() < coolUntil.tiingo) limited = true;
    else {
      try {
        const points = await getHistory(sym, startDate);
        if (points.length >= 2) return { points, source: "tiingo", adjusted: true };
        errors.push("Tiingo: no price history");
      } catch (e) {
        if (e.status === 429) { coolUntil.tiingo = Date.now() + 10 * 60 * 1000; limited = true; }
        errors.push(e.message);
      }
    }
  }
  if (tdKey()) {
    if (Date.now() < coolUntil.twelvedata) limited = true;
    else {
      try {
        return { ...(await getHistoryTD(sym, startDate)), source: "twelvedata" };
      } catch (e) {
        if (e.status === 429) { coolUntil.twelvedata = Date.now() + 60 * 1000; limited = true; }
        errors.push(e.message);
      }
    }
  }
  if (!process.env.TIINGO_KEY && !tdKey()) errors.push("No data provider key is set in Netlify.");
  return { error: errors.join(" | ") || "Data provider limits reached", rateLimited: limited };
}

// Returns { points, source, adjusted, fetchedAt } or { error, rateLimited }.
// force: refresh even if the saved copy is still fresh (used by the daily job).
export async function getSeries(sym, { force = false } = {}) {
  const pre = PREDECESSORS[sym.toUpperCase()];
  const stored = await readStored(sym);
  const needsChain = pre && stored && !stored.chainedFrom && !(stored.chainTriedAt && Date.now() - stored.chainTriedAt < RETRY_CHAIN_MS);
  if (stored && !force && !needsChain && Date.now() - stored.fetchedAt < FRESH_MS) return stored;

  const r = await fetchFromProviders(sym);
  if (r.points) {
    // Don't replace dividend-adjusted history with history that isn't.
    if (stored && stored.adjusted && r.adjusted === false) return stored;
    const rec = { points: r.points, source: r.source, adjusted: r.adjusted !== false, fetchedAt: Date.now() };
    if (pre) {
      // Reuse the predecessor's saved history when we have it: it never changes.
      let prePoints = stored && stored.chainedFrom ? stored.prePoints : null;
      if (!prePoints) {
        const p = await fetchFromProviders(pre.symbol);
        if (p.points && p.adjusted !== false) prePoints = p.points;
      }
      const joined = prePoints && chainHistory(r.points, prePoints);
      if (joined) Object.assign(rec, { points: joined, prePoints, chainedFrom: pre.symbol, chainNote: pre.note });
      else rec.chainTriedAt = Date.now();
    }
    await writeStored(sym, rec);
    return rec;
  }
  // Provider unavailable or limited: yesterday's saved copy is fine for a monthly backtest.
  if (stored) return stored;
  return r;
}
