export async function switchWalletNetwork(provider, target) {
  const chainId = "0x" + target.chainId.toString(16);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (e) {
    if (Number(e.code ?? e.cause?.code) !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: target.chainName,
          nativeCurrency: {
            name: target.nativeSymbol,
            symbol: target.nativeSymbol,
            decimals: 18,
          },
          rpcUrls: [target.rpc],
          blockExplorerUrls: [target.explorer],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  if (
    Number(await provider.request({ method: "eth_chainId" })) !== target.chainId
  )
    throw Error("Wallet did not switch to the selected network.");
}
