import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  custom,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import deployment from "./deployment.json";
import abis from "./abis.json";
export const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpc] } },
  blockExplorers: { default: { name: "Explorer", url: deployment.explorer } },
  testnet: true,
});
export const client = createPublicClient({
  chain,
  transport: http(deployment.rpc, { timeout: 15000, retryCount: 1 }),
});
export { deployment, abis };
export const read = (address, name, functionName, args = []) =>
  client.readContract({ address, abi: abis[name], functionName, args });
export async function query(fn, args = []) {
  if (!deployment.gateway) throw Error("The test deployment is not ready.");
  const result = await read(deployment.gateway, "AppGateway", "query", [
    encodeFunctionData({ abi: abis.Voidfun, functionName: fn, args }),
  ]);
  return decodeFunctionResult({
    abi: abis.Voidfun,
    functionName: fn,
    data: result,
  });
}
export async function connect() {
  if (!window.ethereum)
    throw Error("Open this site in an EVM wallet browser or install a wallet.");
  const [account] = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!account) throw Error("No wallet selected.");
  return account;
}
export async function wallet(expected) {
  const account = await connect();
  if (expected && account.toLowerCase() !== expected.toLowerCase())
    throw Error("Wallet changed. Review the operation again.");
  const id = "0x" + chain.id.toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: id }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: id,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [deployment.rpc],
          blockExplorerUrls: [deployment.explorer],
        },
      ],
    });
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: id }],
    });
  }
  return createWalletClient({
    account,
    chain,
    transport: custom(window.ethereum),
  });
}
export async function confirmed(hash, onStatus) {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 180000,
    });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw Error("Receipt is not canonical yet.");
  } catch (e) {
    onStatus({
      kind: "pending",
      text:
        "Check the transaction before retrying. " +
        (e.shortMessage ?? e.message),
      hash,
    });
    throw e;
  }
  localStorage.removeItem("voidfun-pending");
  if (receipt.status !== "success") {
    onStatus({ kind: "error", text: "Transaction reverted", hash });
    throw Error("Transaction reverted.");
  }
  onStatus({ kind: "success", text: "Transaction completed", hash });
  return receipt;
}
function requireNoPending() {
  if (localStorage.getItem("voidfun-pending"))
    throw Error(
      "A transaction is still pending. Reload to check its receipt before sending another.",
    );
}
export async function direct(name, address, fn, args, account, onStatus) {
  requireNoPending();
  const w = await wallet(account);
  const spec = { address, abi: abis[name], functionName: fn, args };
  await client.simulateContract({ ...spec, account: w.account });
  onStatus({ text: "Confirm in your wallet." });
  const hash = await w.writeContract(spec);
  localStorage.setItem("voidfun-pending", hash);
  onStatus({ kind: "pending", text: "Transaction submitted", hash });
  return confirmed(hash, onStatus);
}
export async function execute(fn, args, value, account, onStatus) {
  requireNoPending();
  const w = await wallet(account);
  const [toll, revision] = await read(deployment.runtime, "Runtime", "quote", [
    1n,
  ]);
  const spec = {
    address: deployment.runtime,
    abi: abis.Runtime,
    functionName: "execute",
    args: [
      deployment.gateway,
      encodeFunctionData({ abi: abis.Voidfun, functionName: fn, args }),
      revision,
      toll,
      value,
      1900000n,
      BigInt(Math.floor(Date.now() / 1000) + 600),
    ],
    value: value + toll,
    gas: 3000000n,
  };
  await client.simulateContract({ ...spec, account: w.account });
  onStatus({ text: "Confirm in your wallet." });
  const hash = await w.writeContract(spec);
  localStorage.setItem("voidfun-pending", hash);
  onStatus({ kind: "pending", text: "Transaction submitted", hash });
  return confirmed(hash, onStatus);
}
