// Testnet-only deployment. Fees must be provided explicitly, never inferred from local tests.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  toHex,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
const config = JSON.parse(fs.readFileSync("src/deployment.json"));
const values = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
for (const key of [
  "trade-bps",
  "protocol-share-bps",
  "creation-fee-wei",
  "treasury",
])
  if (values[key] === undefined)
    throw Error("Missing explicit --" + key + "=value");
const fee = BigInt(values["trade-bps"]),
  share = BigInt(values["protocol-share-bps"]),
  creation = BigInt(values["creation-fee-wei"]);
if (
  fee < 0n ||
  fee > 1000n ||
  share < 0n ||
  share > 5000n ||
  creation < 0n ||
  !isAddress(values.treasury)
)
  throw Error("Invalid economics");
if (!process.env.VOIDFUN_DEPLOYER_KEY)
  throw Error(
    "Set VOIDFUN_DEPLOYER_KEY securely in the process environment. Never paste it into source files.",
  );
const account = privateKeyToAccount(process.env.VOIDFUN_DEPLOYER_KEY);
const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpc] } },
});
const client = createPublicClient({ chain, transport: http(config.rpc) }),
  wallet = createWalletClient({ account, chain, transport: http(config.rpc) });
if ((await client.getChainId()) !== 46630) throw Error("Wrong chain");
const artifact = (name) =>
  JSON.parse(fs.readFileSync("artifacts/" + name + ".json"));
for (const address of [config.runtime, config.price])
  if (((await client.getCode({ address })) ?? "0x") === "0x")
    throw Error("Missing protocol bytecode");
await client.readContract({
  address: config.runtime,
  abi: artifact("Runtime").abi,
  functionName: "quote",
  args: [1n],
});
fs.mkdirSync("deployments", { recursive: true });
fs.mkdirSync(".tools", { recursive: true });
const path = "deployments/46630.json";
const terms = {
  fee: String(fee),
  share: String(share),
  creation: String(creation),
  treasury: values.treasury.toLowerCase(),
  publisher: account.address.toLowerCase(),
  runtime: config.runtime,
  price: config.price,
};
let state = fs.existsSync(path)
  ? JSON.parse(fs.readFileSync(path))
  : { terms, transactions: {} };
if (JSON.stringify(state.terms) !== JSON.stringify(terms))
  throw Error(
    "Existing deployment terms differ. Review the existing manifest before a new deployment.",
  );
const save = () => fs.writeFileSync(path, JSON.stringify(state, null, 2));
// Persist the signed transaction before broadcast: retries reuse identical bytes and nonce.
async function send(name, request) {
  let record = state.transactions[name];
  if (!record) {
    const prepared = await wallet.prepareTransactionRequest(request);
    const gas = await client.estimateGas({ ...request, account });
    prepared.gas = (gas * 120n) / 100n;
    const serialized = await wallet.signTransaction(prepared);
    const hash = keccak256(serialized);
    fs.writeFileSync(".tools/" + name + ".signed-tx", serialized);
    record = state.transactions[name] = { hash };
    save();
  }
  let receipt = await client
    .getTransactionReceipt({ hash: record.hash })
    .catch(() => null);
  if (!receipt) {
    const serialized = fs.readFileSync(".tools/" + name + ".signed-tx", "utf8");
    try {
      await client.sendRawTransaction({ serializedTransaction: serialized });
    } catch (e) {
      const known = await client
        .getTransaction({ hash: record.hash })
        .catch(() => null);
      if (!known) throw e;
    }
    receipt = await client.waitForTransactionReceipt({
      hash: record.hash,
      confirmations: 2,
      timeout: 180000,
    });
  }
  if (receipt.status !== "success")
    throw Error(name + " reverted: " + record.hash);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) throw Error("Noncanonical receipt");
  record.block = String(receipt.blockNumber);
  record.address = receipt.contractAddress;
  record.confirmed = true;
  save();
  console.log(name, record.hash);
  return receipt;
}
async function deploy(name, args = []) {
  const a = artifact(name);
  const r = await send(name, {
    data: encodeDeployData({
      abi: a.abi,
      bytecode: "0x" + a.evm.bytecode.object,
      args,
    }),
  });
  if (
    !r.contractAddress ||
    ((await client.getCode({ address: r.contractAddress })) ?? "0x") === "0x"
  )
    throw Error("Missing deployed code");
  return r.contractAddress;
}
// When using a shared operator wallet, caller must hold the protocol operator advisory lock throughout this process.
const token = await deploy("LaunchToken"),
  curve = await deploy("LaunchCurve");
const logic = await deploy("Voidfun", [
  config.runtime,
  config.price,
  values.treasury,
  token,
  curve,
  fee,
  share,
  creation,
]);
const receipt = await send("publish", {
  to: config.runtime,
  data: encodeFunctionData({
    abi: artifact("Runtime").abi,
    functionName: "publish",
    args: [1n, logic, "0x", keccak256(toHex("voidfun-rh-testnet-v1"))],
  }),
});
const event = receipt.logs
  .filter((l) => l.address.toLowerCase() === config.runtime.toLowerCase())
  .map((log) => {
    try {
      return decodeEventLog({ abi: artifact("Runtime").abi, ...log });
    } catch {
      return null;
    }
  })
  .find((e) => e?.eventName === "AppPublished");
if (!event)
  throw Error(
    "Publication event not found. Inspect receipt before continuing.",
  );
state.gateway = event.args.app;
state.implementation = logic;
save();
fs.writeFileSync(
  "src/deployment.json",
  JSON.stringify(
    {
      ...config,
      gateway: state.gateway,
      implementation: logic,
      status: "deployed-awaiting-public-smoke-test",
    },
    null,
    2,
  ),
);
console.log(
  "Gateway",
  state.gateway,
  "Deed 0001. Confirm an EVM block after publication before execution.",
);
