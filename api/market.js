import { networks, loadMarket, serialize } from "../shared/market.js";
import { cached } from "../shared/response-cache.js";
export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).end();
  const params = new URL(request.url, "https://voidfun.example").searchParams;
  const d = networks.find((n) => n.chainId === Number(params.get("chain")));
  if (!d) return response.status(400).json({ error: "Unsupported network." });
  const offset = Number(params.get("offset") ?? 0),
    curve = params.get("curve")?.toLowerCase();
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000000 ||
    (curve && !/^0x[0-9a-f]{40}$/.test(curve))
  )
    return response.status(400).json({ error: "Invalid market selection." });
  try {
    const value = await cached(
      `${d.chainId}:${d.gateway}:${offset}:${curve ?? ""}`,
      () => loadMarket(d, { offset, curve }),
    );
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=15");
    response.setHeader("Content-Type", "application/json");
    return response.status(200).send(serialize(value));
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response
      .status(503)
      .json({
        error: "Market data is temporarily unavailable. Try again shortly.",
      });
  }
}
