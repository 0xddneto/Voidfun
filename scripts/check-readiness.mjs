import fs from "node:fs";
import { createPublicClient, http, parseEther, formatEther } from "viem";
const d = JSON.parse(fs.readFileSync("src/deployment.json"));
const c = createPublicClient({
  transport: http(d.rpc, { timeout: 15000, retryCount: 0 }),
});
const abi = JSON.parse(fs.readFileSync("src/abis.json"));
const result = {
  checkedAt: new Date().toISOString(),
  chainId: await c.getChainId(),
  runtimeHasCode: (await c.getCode({ address: d.runtime })) !== "0x",
  priceHasCode: (await c.getCode({ address: d.price })) !== "0x",
};
try {
  result.toll = (
    await c.readContract({
      address: d.runtime,
      abi: abi.Runtime,
      functionName: "quote",
      args: [1n],
    })
  ).map(String);
} catch (e) {
  result.quoteError = e.shortMessage ?? e.message;
}
try {
  result.initialFdvEth = formatEther(
    await c.readContract({
      address: d.price,
      abi: abi.NativePrice,
      functionName: "quote",
      args: [parseEther("3000")],
    }),
  );
} catch (e) {
  result.priceError = e.shortMessage ?? e.message;
}
result.operatorBalanceEth = formatEther(
  await c.getBalance({ address: "0x224385Bd4dBe4c5cb0ab469fe06ACdA734541A94" }),
);
try {
  const r = await fetch(
    "https://www.voidchains.app/api/activation?id=1&chain=46630",
  );
  result.activationStatus = r.status;
  result.activation = await r.json();
} catch (e) {
  result.activationError = e.message;
}
fs.writeFileSync(
  "verification/readiness.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
