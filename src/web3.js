import { switchWalletNetwork } from "./switch-network";
import { connect, selectedProvider } from "./wallets";
export { connect } from "./wallets";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  custom,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import networks from "./networks.json";
export { networks };
import abis from "./abis.json";
export function createNetworkContext(deployment) {
  const nativeSymbol = deployment.nativeSymbol;
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.chainName,
    nativeCurrency: {
      name: deployment.nativeSymbol,
      symbol: deployment.nativeSymbol,
      decimals: 18,
    },
    rpcUrls: { default: { http: [deployment.rpc] } },
    blockExplorers: { default: { name: "Explorer", url: deployment.explorer } },
    testnet: true,
  });
  const client = createPublicClient({
    chain,
    transport: http(deployment.rpc, { timeout: 15000, retryCount: 1 }),
  });

  const read = (address, name, functionName, args = []) =>
    client.readContract({ address, abi: abis[name], functionName, args });
  async function query(fn, args = []) {
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
  async function wallet(expected, target = deployment) {
    const account = await connect();
    if (expected && account.toLowerCase() !== expected.toLowerCase())
      throw Error("Wallet changed. Review the operation again.");
    const provider = selectedProvider();
    await switchWalletNetwork(provider, target);
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts?.[0]?.toLowerCase() !== account.toLowerCase())
      throw Error("Wallet changed. Review the operation again.");
    return createWalletClient({
      account,
      chain,
      transport: custom(provider),
    });
  }
  async function confirmed(hash, onStatus) {
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
    localStorage.removeItem(`voidfun-pending:${deployment.runtime}`);
    if (receipt.status !== "success") {
      onStatus({ kind: "error", text: "Transaction reverted", hash });
      throw Error("Transaction reverted.");
    }
    onStatus({ kind: "success", text: "Transaction completed", hash });
    return receipt;
  }
  function requireNoPending() {
    if (localStorage.getItem(`voidfun-pending:${deployment.runtime}`))
      throw Error(
        "A transaction is still pending. Reload to check its receipt before sending another.",
      );
  }
  async function direct(name, address, fn, args, account, onStatus) {
    requireNoPending();
    const w = await wallet(account);
    const spec = { address, abi: abis[name], functionName: fn, args };
    await client.simulateContract({ ...spec, account: w.account });
    onStatus({ text: "Confirm in your wallet." });
    const hash = await w.writeContract(spec);
    localStorage.setItem(`voidfun-pending:${deployment.runtime}`, hash);
    onStatus({ kind: "pending", text: "Transaction submitted", hash });
    return confirmed(hash, onStatus);
  }
  async function execute(fn, args, value, account, onStatus) {
    if (!deployment.gateway)
      throw Error("Publish the application manually on this network first.");
    requireNoPending();
    const w = await wallet(account);
    const [toll, revision] = await read(
      deployment.runtime,
      "Runtime",
      "quote",
      [BigInt(deployment.deedId)],
    );
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
    localStorage.setItem(`voidfun-pending:${deployment.runtime}`, hash);
    onStatus({ kind: "pending", text: "Transaction submitted", hash });
    return confirmed(hash, onStatus);
  }

  return {
    deployment,
    nativeSymbol,
    chain,
    client,
    abis,
    read,
    query,
    wallet,
    confirmed,
    direct,
    execute,
    connect,
  };
}
