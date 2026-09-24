import assert from "node:assert/strict";
import fs from "node:fs";
import { switchWalletNetwork } from "../src/switch-network.js";
const ns = JSON.parse(fs.readFileSync("src/networks.json"));
for (const n of ns) {
  let active = 1,
    added = false;
  const calls = [];
  const provider = {
    request: async (r) => {
      calls.push(r);
      if (r.method === "wallet_switchEthereumChain") {
        if (!added) throw { code: 4902 };
        active = Number(r.params[0].chainId);
      }
      if (r.method === "wallet_addEthereumChain") added = true;
      if (r.method === "eth_chainId") return "0x" + active.toString(16);
    },
  };
  await switchWalletNetwork(provider, n);
  assert.equal(active, n.chainId);
  const add = calls.find((c) => c.method === "wallet_addEthereumChain")
    .params[0];
  assert.equal(add.nativeCurrency.symbol, n.nativeSymbol);
  assert.deepEqual(add.rpcUrls, [n.rpc]);
  assert.equal(add.nativeCurrency.decimals, 18);
}
await assert.rejects(() =>
  switchWalletNetwork(
    {
      request: async () => {
        throw { code: 4001 };
      },
    },
    ns[0],
  ),
);
await assert.rejects(
  () =>
    switchWalletNetwork(
      { request: async (r) => (r.method === "eth_chainId" ? "0x1" : null) },
      ns[0],
    ),
  /did not switch/,
);
assert.equal(new Set(ns.map((n) => n.runtimeFactory)).size, 5);
assert(ns.every((n) => n.protocolRelease === "voiddeeds-genesis-20260922"));
assert(
  ns.every((n) => !n.gateway || (n.runtime && n.publicationTx && n.publisher)),
);
assert(
  !fs
    .readFileSync("scripts/deploy.mjs", "utf8")
    .includes('functionName: "publish"'),
);
console.log(
  "PASS five network switches/additions, rejection, wrong-chain guard, isolated runtimes and manual publication",
);
