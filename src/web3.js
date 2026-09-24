import { switchWalletNetwork } from "./switch-network";
import { connect, selectedProvider } from "./wallets";
export { connect } from "./wallets";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  custom,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import networks from "./networks.json";
export { networks };
import abis from "./abis.json";
import {
  pendingTransaction,
  savePending,
  clearPending,
  receiptState,
} from "./transactions";
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
    pollingInterval: 1000,
    transport: fallback(
      [deployment.rpc, ...(deployment.rpcFallbacks ?? [])].map((url) =>
        http(url, {
          batch: { batchSize: 50, wait: 10 },
          timeout: 15000,
          retryCount: 1,
        }),
      ),
      { retryCount: 1 },
    ),
  });

  const read = (address, name, functionName, args = []) =>
    client.readContract({ address, abi: abis[name], functionName, args });
  async function query(fn, args = []) {
    if (!deployment.gateway) throw Error("The test deployment is not ready.");
    const result = await read(deployment.gateway, "Gateway", "query", [
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
  async function confirmed(record, onStatus, once = false) {
    const deadline = Date.now() + 180000;
    do {
      try {
        const state = await receiptState(client, record);
        if (state.kind !== "pending") {
          clearPending(record);
          const text =
            state.kind === "success"
              ? "Transaction completed"
              : state.kind === "replaced"
                ? "Transaction replaced or cancelled"
                : "Transaction reverted";
          onStatus({
            kind: state.kind === "success" ? "success" : "error",
            text,
            hash: state.hash,
          });
          if (state.kind !== "success")
            throw Object.assign(Error(text), { terminal: true });
          return state.receipt;
        }
      } catch (e) {
        if (e.terminal) throw e;
      }
      onStatus({
        kind: "pending",
        text: "Transaction submitted. Waiting for confirmation.",
        hash: record.hash,
      });
      if (once) return null;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } while (Date.now() < deadline);
    throw Error(
      "Confirmation is taking longer. Your pending transaction will be checked again automatically.",
    );
  }
  function requireNoPending(account) {
    if (pendingTransaction(deployment.chainId, account))
      throw Error(
        "A transaction is still pending on this network. Wait for its confirmation before retrying.",
      );
  }
  async function send(w, spec, onStatus) {
    const data = encodeFunctionData({
      abi: spec.abi,
      functionName: spec.functionName,
      args: spec.args,
    });
    const nonce = await client.getTransactionCount({
      address: w.account.address,
      blockTag: "pending",
    });
    const hash = await w.writeContract({ ...spec, nonce });
    const record = {
      chainId: deployment.chainId,
      account: w.account.address,
      hash,
      nonce,
      to: spec.address,
      data,
      value: String(spec.value ?? 0n),
    };
    savePending(record);
    onStatus({ kind: "pending", text: "Transaction submitted", hash });
    return confirmed(record, onStatus);
  }
  async function direct(name, address, fn, args, account, onStatus) {
    requireNoPending(account);
    const w = await wallet(account);
    const spec = { address, abi: abis[name], functionName: fn, args };
    await client.simulateContract({ ...spec, account: w.account });
    onStatus({ text: "Confirm in your wallet." });
    return send(w, spec, onStatus);
  }
  async function execute(fn, args, value, account, onStatus) {
    if (!deployment.gateway)
      throw Error("Publish the application manually on this network first.");
    requireNoPending(account);
    const w = await wallet(account);
    const actualRuntime = await read(
      deployment.runtimeFactory,
      "RuntimeFactory",
      "runtimeOf",
      [BigInt(deployment.deedId)],
    );
    if (actualRuntime.toLowerCase() !== deployment.runtime?.toLowerCase())
      throw Error("Application runtime does not match this network.");
    const registration = await read(
      actualRuntime,
      "DeedRuntime",
      "applications",
      [deployment.gateway],
    );
    if (
      !registration[3] ||
      registration[1].toLowerCase() !== deployment.implementation.toLowerCase()
    )
      throw Error(
        "Application is not registered with the configured implementation.",
      );
    const [toll, revision] = await read(
      deployment.runtime,
      "DeedRuntime",
      "quote",
      [],
    );
    const spec = {
      address: deployment.runtime,
      abi: abis.DeedRuntime,
      functionName: "execute",
      args: [
        {
          app: deployment.gateway,
          data: encodeFunctionData({
            abi: abis.Voidfun,
            functionName: fn,
            args,
          }),
          revision,
          maxToll: toll,
          appValue: value,
          appGas: 1900000n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        },
      ],
      value: value + toll,
      gas: 3000000n,
    };
    await client.simulateContract({ ...spec, account: w.account });
    onStatus({ text: "Confirm in your wallet." });
    return send(w, spec, onStatus);
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
