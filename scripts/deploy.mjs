process.on("uncaughtException", (e) => {
  console.error(
    "DEPLOY_ERROR:",
    (e.shortMessage ?? e.message)
      .replace(/0x[0-9a-fA-F]{64,}/g, "[redacted]")
      .slice(0, 400),
  );
  process.exit(1);
});
// Testnet-only deployment. Fees must be provided explicitly, never inferred from local tests.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeDeployData,
  keccak256,
  isAddress,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
const configs = JSON.parse(fs.readFileSync("src/networks.json"));
const values = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const config = configs.find((n) => n.chainId === Number(values.chain));
if (!config) throw Error("Provide a supported --chain=id");
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
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: {
    name: config.nativeSymbol,
    symbol: config.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: { default: { http: [config.rpc] } },
});
const client = createPublicClient({ chain, transport: http(config.rpc) }),
  wallet = createWalletClient({ account, chain, transport: http(config.rpc) });
if ((await client.getChainId()) !== config.chainId) throw Error("Wrong chain");
const artifact = (name) =>
  JSON.parse(fs.readFileSync("artifacts/" + name + ".json"));
for (const address of [config.runtimeFactory, config.price])
  if (((await client.getCode({ address })) ?? "0x") === "0x")
    throw Error("Missing protocol bytecode");
fs.mkdirSync("deployments", { recursive: true });
fs.mkdirSync(".tools", { recursive: true });
const releaseTag =
  config.protocolRelease +
  "-" +
  config.runtimeFactory.toLowerCase().slice(2, 10);
const path = `deployments/${config.chainId}-${releaseTag}.json`;
const terms = {
  fee: String(fee),
  share: String(share),
  creation: String(creation),
  treasury: values.treasury.toLowerCase(),
  publisher: account.address.toLowerCase(),
  runtimeFactory: config.runtimeFactory,
  price: config.price,
  build: keccak256(
    toHex(fs.readFileSync("artifacts/compiler-input.json", "utf8")),
  ),
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
    const [pending, latest] = await Promise.all([
      client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
      client.getTransactionCount({
        address: account.address,
        blockTag: "latest",
      }),
    ]);
    if (pending !== latest)
      throw Error(
        "Operator has a pending transaction; retry after confirmation.",
      );
    const prepared = await wallet.prepareTransactionRequest({
      ...request,
      nonce: latest,
    });
    const gas = await client.estimateGas({ ...request, account });
    prepared.gas = (gas * 120n) / 100n;
    const maximumCost =
      prepared.gas * (prepared.maxFeePerGas ?? prepared.gasPrice);
    const balance = await client.getBalance({ address: account.address });
    if (maximumCost > balance / 2n)
      throw Error(
        "Deployment would consume more than half of the available test gas. Fund the wallet first.",
      );
    const serialized = await wallet.signTransaction(prepared);
    const hash = keccak256(serialized);
    fs.writeFileSync(
      ".tools/" + config.chainId + "-" + releaseTag + "-" + name + ".signed-tx",
      serialized,
    );
    record = state.transactions[name] = { hash };
    save();
  }
  let receipt = await client
    .getTransactionReceipt({ hash: record.hash })
    .catch(() => null);
  if (!receipt) {
    const serialized = fs.readFileSync(
      ".tools/" + config.chainId + "-" + releaseTag + "-" + name + ".signed-tx",
      "utf8",
    );
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
  let canonical = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    receipt = await client.getTransactionReceipt({ hash: record.hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (block.hash === receipt.blockHash && head >= receipt.blockNumber + 1n) {
      canonical = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!canonical)
    throw Error("Noncanonical receipt; retry the persisted transaction later");
  if (receipt.status !== "success") throw Error(name + " reverted");
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
    ((await client.getCode({
      address: r.contractAddress,
      blockNumber: r.blockNumber,
    })) ?? "0x") === "0x"
  )
    throw Error("Missing deployed code");
  return r.contractAddress;
}
// Each signed transaction is persisted before broadcast; do not run two deploy processes for the same signer and chain.
const token = await deploy("LaunchToken"),
  curve = await deploy("LaunchCurve");
const logic = await deploy("Voidfun", [
  config.runtimeFactory,
  config.price,
  values.treasury,
  token,
  curve,
  fee,
  share,
  creation,
]);
state.implementation = logic;
save();
Object.assign(config, {
  implementation: logic,
  status: "awaiting-manual-publication",
  deploymentManifest: path,
});
fs.writeFileSync("src/networks.json", JSON.stringify(configs, null, 2) + "\n");
console.log(
  "Implementation ready for manual publication:",
  config.chainName,
  logic,
);
