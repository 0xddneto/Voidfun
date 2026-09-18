// Read-only on-chain verification; only writes the local manifest after manual publication.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  createPublicClient,
  http,
  decodeEventLog,
  isAddress,
  isHash,
} from "viem";
const args = Object.fromEntries(
  process.argv.slice(2).map((v) => v.replace(/^--/, "").split("=")),
);
const ns = JSON.parse(fs.readFileSync("src/networks.json"));
const d = ns.find((n) => n.chainId === Number(args.chain));
if (
  !d?.implementation ||
  !isHash(args.tx ?? "") ||
  !isAddress(args.publisher ?? "")
)
  throw Error("Supply --chain=ID --tx=HASH --publisher=ADDRESS");
const abi = JSON.parse(fs.readFileSync("src/abis.json"));
const c = createPublicClient({ transport: http(d.rpc) });
assert.equal(await c.getChainId(), d.chainId);
const r = await c.getTransactionReceipt({ hash: args.tx });
assert.equal(r.status, "success");
assert.equal(
  (await c.getBlock({ blockNumber: r.blockNumber })).hash,
  r.blockHash,
);
assert(
  (await c.getBlockNumber()) > r.blockNumber,
  "Wait for a block after publication",
);
const events = r.logs
  .filter((l) => l.address.toLowerCase() === d.runtime.toLowerCase())
  .flatMap((l) => {
    try {
      const e = decodeEventLog({ abi: abi.Runtime, ...l });
      return e.eventName === "AppPublished" ? [e] : [];
    } catch {
      return [];
    }
  })
  .filter(
    (e) =>
      e.args.deedId === BigInt(d.deedId) &&
      e.args.implementation.toLowerCase() === d.implementation.toLowerCase() &&
      e.args.publisher.toLowerCase() === args.publisher.toLowerCase(),
  );
assert.equal(events.length, 1, "Expected one matching manual publication");
const gateway = events[0].args.app;
assert.notEqual(await c.getCode({ address: gateway }), "0x");
const read = (address, name, functionName, args = []) =>
  c.readContract({ address, abi: abi[name], functionName, args });
assert.equal(
  (await read(gateway, "AppGateway", "runtime")).toLowerCase(),
  d.runtime.toLowerCase(),
);
assert.equal(
  (await read(gateway, "AppGateway", "implementation")).toLowerCase(),
  d.implementation.toLowerCase(),
);
assert.equal(await read(gateway, "AppGateway", "deedId"), BigInt(d.deedId));
const registration = await read(d.runtime, "Runtime", "apps", [gateway]);
assert.equal(registration[0], BigInt(d.deedId));
assert.equal(registration[1].toLowerCase(), args.publisher.toLowerCase());
assert.equal(registration[2], true);
if (d.gateway && d.gateway.toLowerCase() !== gateway.toLowerCase())
  throw Error(
    "A different gateway is already configured. Review before replacing.",
  );
Object.assign(d, {
  gateway,
  status: "published",
  deploymentBlock: String(r.blockNumber),
  publisher: args.publisher,
  publicationTx: args.tx,
});
fs.writeFileSync("src/networks.json", JSON.stringify(ns, null, 2) + "\n");
console.log("Verified manual publication:", d.chainName, gateway);
