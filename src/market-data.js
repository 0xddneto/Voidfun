const entries = new Map();
const integerKeys = new Set([
  "fee",
  "trade",
  "share",
  "reserve",
  "tracked",
  "reserved",
  "supply",
  "phantom",
  "feeBps",
]);
export function reviveMarket(text) {
  return JSON.parse(text, (key, value) =>
    integerKeys.has(key) && typeof value === "string" && /^\d+$/.test(value)
      ? BigInt(value)
      : value,
  );
}
export async function marketSnapshot(d, offset = 0, curve) {
  const key = `voidfun:market:v2:${d.chainId}:${d.implementation}:${d.gateway}:${offset}:${curve ?? ""}`;
  let entry = entries.get(key);
  if (entry?.pending) return entry.pending;
  if (entry?.value && Date.now() - entry.at < 10000) return entry.value;
  entry ??= {};
  entries.set(key, entry);
  entry.pending = (async () => {
    try {
      const query = new URLSearchParams({
        chain: String(d.chainId),
        offset: String(offset),
      });
      if (curve) query.set("curve", curve);
      const r = await fetch(`/api/market?${query}`, {
        signal: AbortSignal.timeout(45000),
      });
      const text = await r.text(),
        value = reviveMarket(text);
      if (!r.ok) throw Error(value.error ?? "Market unavailable.");
      entry.value = value;
      entry.at = Date.now();
      try {
        localStorage.setItem(key, text);
      } catch {}
      return value;
    } catch (error) {
      let saved = entry.value;
      if (!saved)
        try {
          saved = reviveMarket(localStorage.getItem(key) ?? "null");
        } catch {}
      if (
        saved?.ready &&
        Array.isArray(saved.rows) &&
        Date.now() - Date.parse(saved.generatedAt) < 7 * 86400000
      )
        return { ...saved, stale: true };
      throw error;
    } finally {
      entry.pending = null;
    }
  })();
  return entry.pending;
}
export function invalidateMarket() {
  for (const entry of entries.values()) entry.at = 0;
}
