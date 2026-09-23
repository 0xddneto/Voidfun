import {
  createPublicClient,
  http,
  fallback,
  encodeFunctionData,
  decodeFunctionResult,
  isAddress,
  formatEther,
} from "viem";
import networks from "../src/networks.json" with { type: "json" };
import abis from "../src/abis.json" with { type: "json" };
export { networks, abis };
const clients = new Map();
export function clientFor(d) {
  if (!clients.has(d.chainId))
    clients.set(
      d.chainId,
      createPublicClient({
        transport: fallback(
          [d.rpc, ...(d.rpcFallbacks ?? [])].map((url) =>
            http(url, { batch: true, timeout: 8000, retryCount: 0 }),
          ),
          { retryCount: 0 },
        ),
      }),
    );
  return clients.get(d.chainId);
}
export async function loadMarket(d, { offset = 0, curve } = {}) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000000 ||
    (curve && !isAddress(curve))
  )
    throw Error("Invalid market selection.");
  if (!d.implementation)
    return {
      ready: false,
      rows: [],
      selected: null,
      count: 0,
      generatedAt: new Date().toISOString(),
      message: "Implementation is being prepared.",
    };
  const c = clientFor(d),
    blockNumber = await c.getBlockNumber({ cacheTime: 0 });
  const read = (address, name, functionName, args = []) =>
    c.readContract({
      address,
      abi: abis[name],
      functionName,
      args,
      blockNumber,
    });
  const [fee, trade, share] = await Promise.all(
    ["CREATE_FEE", "TRADE_FEE_BPS", "PROTOCOL_SHARE_BPS"].map((fn) =>
      read(d.implementation, "Voidfun", fn),
    ),
  );
  const base = {
    ready: true,
    terms: { fee, trade, share },
    generatedAt: new Date().toISOString(),
    block: String(blockNumber),
    rows: [],
    selected: null,
    count: 0,
    offset,
    hasMore: false,
  };
  if (!d.gateway) return { ...base, published: false };
  const actual = await read(d.runtimeFactory, "RuntimeFactory", "runtimeOf", [
    BigInt(d.deedId),
  ]);
  if (actual.toLowerCase() !== d.runtime?.toLowerCase())
    throw Error("Configured runtime is not from the current factory.");
  const registration = await read(actual, "DeedRuntime", "applications", [
    d.gateway,
  ]);
  if (registration[1].toLowerCase() !== d.implementation.toLowerCase())
    throw Error("Configured application does not match.");
  const query = async (fn, args = []) =>
    decodeFunctionResult({
      abi: abis.Voidfun,
      functionName: fn,
      data: await read(d.gateway, "Gateway", "query", [
        encodeFunctionData({ abi: abis.Voidfun, functionName: fn, args }),
      ]),
    });
  const count = Number(await query("launchCount"));
  const limit = Math.max(0, Math.min(24, count - offset)),
    start = Math.max(0, count - offset - limit);
  const addresses = limit
    ? await query("launches", [BigInt(start), BigInt(limit)])
    : [];
  if (curve && !(await query("isCurve", [curve])))
    throw Error("Token is not part of this application.");
  const load = async (address) => {
    const fields = [
      "token",
      "creator",
      "realReserve",
      "trackedTokens",
      "reservedTokens",
      "supply",
      "phantomQuote",
      "complete",
      "feeBps",
      "protocolShareBps",
    ];
    const [
      token,
      creator,
      reserve,
      tracked,
      reserved,
      supply,
      phantom,
      complete,
      feeBps,
      share,
    ] = await Promise.all(fields.map((fn) => read(address, "LaunchCurve", fn)));
    const [name, symbol] = await Promise.all(
      ["name", "symbol"].map((fn) => read(token, "LaunchToken", fn)),
    );
    return {
      address,
      token,
      creator,
      reserve,
      tracked,
      reserved,
      supply,
      phantom,
      complete,
      feeBps,
      share,
      name,
      symbol,
      fdv: Number(formatEther(((phantom + reserve) * supply) / tracked)),
      progress:
        Number(((supply - tracked) * 10000n) / (supply - reserved)) / 100,
    };
  };
  const rows = [];
  // Bound RPC fanout independently of how many launch tokens exist.
  for (let index = 0; index < addresses.length; index += 4)
    rows.push(
      ...(await Promise.all(addresses.slice(index, index + 4).map(load))),
    );
  const selected = curve
    ? (rows.find((row) => row.address.toLowerCase() === curve.toLowerCase()) ??
      (await load(curve)))
    : null;
  const oneDollar = await read(d.price, "TestnetPriceOracle", "quote", [
    10n ** 18n,
  ]).catch(() => null);
  return {
    ...base,
    published: registration[3],
    count,
    hasMore: offset + limit < count,
    rows: rows.reverse(),
    selected,
    ethUsd: oneDollar ? 1 / Number(formatEther(oneDollar)) : null,
    priceUnavailable: !oneDollar,
  };
}
export function serialize(value) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? String(item) : item,
  );
}
