import fs from "node:fs";
import assert from "node:assert/strict";
import { formatEther, parseEther } from "viem";
import { networks, clientFor, abis } from "../shared/market.js";
const d = networks.find((n) => n.chainId === Number(process.argv[2] ?? 46630));
if (!d) throw Error("Unsupported network.");
const c = clientFor(d);
assert.equal(await c.getChainId(), d.chainId);
const result = {
  checkedAt: new Date().toISOString(),
  chainId: d.chainId,
  release: d.protocolRelease,
  published: Boolean(d.gateway),
  implementation: d.implementation,
  contracts: {},
};
for (const [name, address] of Object.entries({
  factory: d.runtimeFactory,
  oracle: d.price,
  ...(d.implementation ? { implementation: d.implementation } : {}),
})) {
  result.contracts[name] = Boolean((await c.getCode({ address }))?.length > 2);
  assert(result.contracts[name], name + " has no code");
}
try {
  result.initialFdvNative = formatEther(
    await c.readContract({
      address: d.price,
      abi: abis.TestnetPriceOracle,
      functionName: "quote",
      args: [parseEther("3000")],
    }),
  );
} catch {
  result.oracleUnavailable = true;
}
result.operatorBalanceNative = formatEther(
  await c.getBalance({ address: "0x224385Bd4dBe4c5cb0ab469fe06ACdA734541A94" }),
);
fs.writeFileSync(
  "verification/readiness-" + d.chainId + ".json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
