import { networks, serialize } from "../shared/market.js";
import { loadHistory } from "../shared/history.js";
import { cached } from "../shared/response-cache.js";
export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).end();
  const p = new URL(request.url, "https://voidfun.example").searchParams,
    d = networks.find((n) => n.chainId === Number(p.get("chain"))),
    curve = p.get("curve")?.toLowerCase(),
    before = p.get("before") ?? undefined;
  if (
    !d ||
    !/^0x[0-9a-f]{40}$/.test(curve ?? "") ||
    (before !== undefined && !/^\d{1,16}$/.test(before))
  )
    return response.status(400).json({ error: "Invalid history selection." });
  if (!d.gateway)
    return response
      .status(409)
      .json({ error: "Application not published on this network." });
  try {
    const value = await cached(
      `history:${d.chainId}:${d.gateway}:${curve}:${before ?? "latest"}`,
      () => loadHistory(d, curve, before),
    );
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=15");
    response.setHeader("Content-Type", "application/json");
    return response.status(200).send(serialize(value));
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response
      .status(503)
      .json({ error: "History unavailable. Please retry." });
  }
}
