import deployment from "./deployment.json";
export const walletConnectConfigured = Boolean(
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim(),
);
export async function mobileProvider(onUri, signal) {
  if (!walletConnectConfigured)
    throw Error(
      "Mobile wallet connection is not available yet. Use a browser wallet for now.",
    );
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  if (signal.aborted)
    throw new DOMException("Connection cancelled", "AbortError");
  const provider = await EthereumProvider.init({
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID.trim(),
    optionalChains: [deployment.chainId],
    showQrModal: false,
    rpcMap: { [deployment.chainId]: deployment.rpc },
    metadata: {
      name: "Voidfun",
      description: "Voidfun launchpad on Robinhood Testnet",
      url: window.location.origin,
      icons: [window.location.origin + "/voidfun-icon.svg"],
    },
  });
  if (signal.aborted) {
    if (provider.session) await provider.disconnect();
    throw new DOMException("Connection cancelled", "AbortError");
  }
  const display = (uri) => {
    if (!signal.aborted && /^wc:/.test(uri)) onUri(uri);
  };
  provider.on("display_uri", display);
  const cancel = () => {
    provider.signer.abortPairingAttempt();
    provider.removeListener("display_uri", display);
    if (provider.session) provider.disconnect().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  return {
    provider,
    cleanup: () => {
      provider.removeListener("display_uri", display);
      signal.removeEventListener("abort", cancel);
    },
  };
}
