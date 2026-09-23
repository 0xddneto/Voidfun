// Read-only protocol import. Never creates runtimes, publishes gateways or sends transactions.
import fs from "node:fs";
import path from "node:path";
const source = process.argv
  .find((arg) => arg.startsWith("--source="))
  ?.slice(9);
if (!source) throw Error("Provide --source=/path/to/reviewed/protocol/config");
const release = JSON.parse(fs.readFileSync(path.join(source, "release.json")));
const chains = JSON.parse(fs.readFileSync(path.join(source, "networks.json")));
const previous = JSON.parse(fs.readFileSync("src/networks.json"));
if (
  previous.some((n) => n.gateway) &&
  !process.argv.includes("--reset-publication")
)
  throw Error(
    "Explicit --reset-publication is required to detach previous gateways.",
  );
fs.mkdirSync(".tools", { recursive: true });
fs.writeFileSync(
  ".tools/before-network-update.json",
  JSON.stringify(previous, null, 2),
);
const networks = previous.map((old) => {
  const n = chains.find((n) => n.id === old.chainId),
    d = release.networks[old.chainId];
  if (!n || !d) throw Error("Missing reviewed network.");
  return {
    chainId: n.id,
    chainName: n.name,
    nativeSymbol: n.symbol,
    rpc: n.rpcs[0],
    rpcFallbacks: n.rpcs.slice(1),
    explorer: n.explorer,
    protocolRelease: release.id,
    collection: release.collection,
    registry: d.registry,
    runtimeFactory: d.factory,
    price: d.oracle,
    deedId: "1",
    runtime: null,
    gateway: null,
    implementation: null,
    publisher: null,
    publicationTx: null,
    status: "implementation-pending",
    deploymentBlock: "0",
  };
});
fs.writeFileSync("src/networks.json", JSON.stringify(networks, null, 2) + "\n");
console.log(
  "Imported five network references. All publication fields are empty. No chain writes.",
);
