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
  const stored = await readStored(sym);
  if (stored && !force && Date.now() - stored.fetchedAt < FRESH_MS) return stored;

  const r = await fetchFromProviders(sym);
  if (r.points) {
    // Don't replace dividend-adjusted history with history that isn't.
    if (stored && stored.adjusted && r.adjusted === false) return stored;
    const rec = { points: r.points, source: r.source, adjusted: r.adjusted !== false, fetchedAt: Date.now() };
    await writeStored(sym, rec);
    return rec;
  }
  // Provider unavailable or limited: yesterday's saved copy is fine for a monthly backtest.
  if (stored) return stored;
  return r;
}
