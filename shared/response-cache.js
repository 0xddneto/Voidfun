const entries = new Map(),
  running = new Map();
export async function cached(key, load, ttl = 15000) {
  const saved = entries.get(key);
  if (saved && Date.now() - saved.at < ttl) return saved.data;
  if (running.has(key)) return running.get(key);
  const task = (async () => {
    try {
      const data = await load();
      entries.set(key, { at: Date.now(), data });
      if (entries.size > 250) entries.delete(entries.keys().next().value);
      return data;
    } catch (error) {
      if (saved && Date.now() - saved.at < 86400000)
        return { ...saved.data, stale: true };
      throw error;
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, task);
  return task;
}
