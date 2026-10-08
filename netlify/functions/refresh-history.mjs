// Scheduled job: every weekday evening after the US close, refresh the saved
// price history for the 22 sector stocks and SPY, then any other saved stocks
// whose copies are oldest, within a budget that stays under Tiingo's free
// limit of 50 requests an hour. This keeps the home page from ever waiting on
// a data provider.
import { SECTOR_SYMBOLS } from "../lib/sectors.mjs";
import { getSeries, readStored, listStored, FRESH_MS } from "../lib/historyStore.mjs";

const BUDGET = 40;

export default async () => {
  const core = [...SECTOR_SYMBOLS, "SPY"];
  const others = [];
  for (const key of await listStored()) {
    if (core.includes(key)) continue;
    const rec = await readStored(key);
    if (rec && Date.now() - rec.fetchedAt > FRESH_MS) others.push([key, rec.fetchedAt]);
  }
  others.sort((a, b) => a[1] - b[1]);
  const todo = [...core, ...others.map(([k]) => k)].slice(0, BUDGET);

  let ok = 0, failed = [];
  for (const sym of todo) {
    const r = await getSeries(sym, { force: core.includes(sym) });
    if (r.points) ok++; else failed.push(sym);
  }
  console.log(`refresh-history: refreshed ${ok} of ${todo.length}${failed.length ? `; failed ${failed.join(", ")}` : ""}`);
  return new Response("ok");
};

// 22:30 UTC = 6:30 pm New York in summer, 5:30 pm in winter; both after the close.
export const config = { schedule: "30 22 * * 1-5" };
