import { isAddress } from "viem";
// EIP-6963 keeps wallet selection separate from the shared window.ethereum slot.
const discovered = new Map(),
  listeners = new Set(),
  accountListeners = new Set();
let currentAccount,
  active,
  detach = () => {};
const notify = () => listeners.forEach((fn) => fn());
window.addEventListener("eip6963:announceProvider", ({ detail }) => {
  if (!detail?.info?.uuid || typeof detail.provider?.request !== "function")
    return;
  if (discovered.has(detail.info.uuid)) return;
  discovered.set(detail.info.uuid, {
    id: detail.info.uuid,
    name: String(detail.info.name || "Browser wallet").slice(0, 80),
    provider: detail.provider,
  });
  notify();
});
export function discoverWallets() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  notify();
}
export function walletOptions() {
  const result = [...discovered.values()];
  const legacy =
    window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []);
  for (const [index, provider] of legacy.entries())
    if (
      typeof provider?.request === "function" &&
      !result.some((item) => item.provider === provider)
    ) {
      result.push({
        id: "legacy-" + index,
        name: provider.isRabby
          ? "Rabby"
          : provider.isMetaMask
            ? "MetaMask"
            : provider.isCoinbaseWallet
              ? "Coinbase Wallet"
              : "Browser wallet",
        provider,
      });
    }
  return result;
}
export function watchWallets(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function watchAccount(fn) {
  accountListeners.add(fn);
  fn(currentAccount);
  return () => accountListeners.delete(fn);
}
function updateAccount(value) {
  const account = isAddress(value ?? "") ? value : undefined;
  currentAccount = account;
  accountListeners.forEach((fn) => fn(account));
}
export function selectedProvider() {
  if (!active) throw Error("Choose a wallet using Connect wallet first.");
  return active;
}
export function walletError(error) {
  const code = Number(error?.code ?? error?.cause?.code);
  if (code === 4001)
    return "Connection declined. You can choose a wallet and try again.";
  if (code === -32002)
    return "A connection request is already open in your wallet. Open the extension and approve or reject that request, then try again.";
  return (
    error?.shortMessage ?? error?.message ?? "The wallet could not connect."
  );
}
export async function connect(option, { signal } = {}) {
  const provider = option?.provider ?? selectedProvider();
  const accounts =
    provider.isWalletConnect && typeof provider.enable === "function"
      ? await provider.enable()
      : await provider.request({ method: "eth_requestAccounts" });
  if (signal?.aborted)
    throw new DOMException("Connection cancelled", "AbortError");
  if (!Array.isArray(accounts) || !isAddress(accounts[0] ?? ""))
    throw Error(
      "No account shared. Unlock your wallet and allow this site to connect.",
    );
  detach();
  active = provider;
  const changed = (accounts) => updateAccount(accounts?.[0]);
  const disconnected = () => {
    detach();
    active = undefined;
    updateAccount(undefined);
  };
  provider.on?.("accountsChanged", changed);
  provider.on?.("disconnect", disconnected);
  detach = () => {
    provider.removeListener?.("accountsChanged", changed);
    provider.removeListener?.("disconnect", disconnected);
  };
  updateAccount(accounts[0]);
  return accounts[0];
}
discoverWallets();

export async function disconnectWallet() {
  const previous = active;
  detach();
  active = undefined;
  updateAccount(undefined);
  if (previous?.isWalletConnect) await previous.disconnect();
}
