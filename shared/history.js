import { clientFor, abis } from "./market.js";
import { encodeFunctionData, decodeFunctionResult, isAddress } from "viem";
export async function loadHistory(d, curve, before) {
  if (!d.gateway || !isAddress(curve)) throw Error("No published application.");
  const c = clientFor(d),
    head = await c.getBlockNumber({ cacheTime: 0 });
  const data = await c.readContract({
    address: d.gateway,
    abi: abis.Gateway,
    functionName: "query",
    args: [
      encodeFunctionData({
        abi: abis.Voidfun,
        functionName: "isCurve",
        args: [curve],
      }),
    ],
  });
  if (
    !decodeFunctionResult({ abi: abis.Voidfun, functionName: "isCurve", data })
  )
    throw Error("Unknown curve.");
  const end = before === undefined ? head - 1n : BigInt(before);
  if (end > head || end < 0n) throw Error("Invalid history range.");
  const origin = BigInt(d.deploymentBlock),
    start = end > 7999n && end - 7999n > origin ? end - 7999n : origin;
  let logs = [];
  for (let from = start; from <= end; from += 2000n)
    logs.push(
      ...(await c.getLogs({
        address: curve,
        event: abis.LaunchCurve.find(
          (e) => e.name === "Trade" && e.type === "event",
        ),
        fromBlock: from,
        toBlock: from + 1999n > end ? end : from + 1999n,
        strict: true,
      })),
    );
  logs = logs.slice(-60);
  const blocks = new Map();
  for (const log of logs)
    if (!blocks.has(String(log.blockNumber)))
      blocks.set(
        String(log.blockNumber),
        await c.getBlock({ blockNumber: log.blockNumber }),
      );
  // Do not show receipts from a replaced block during a reorganization.
  logs = logs
    .filter((log) => blocks.get(String(log.blockNumber)).hash === log.blockHash)
    .map((log) => ({
      ...log,
      time: Number(blocks.get(String(log.blockNumber)).timestamp),
    }));
  return {
    logs,
    from: String(start),
    to: String(end),
    before: start > origin ? String(start - 1n) : null,
    generatedAt: new Date().toISOString(),
  };
}
