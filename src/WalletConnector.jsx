import React, { useEffect, useRef, useState } from "react";
import {
  connect,
  discoverWallets,
  walletOptions,
  watchWallets,
  walletError,
  disconnectWallet,
} from "./wallets";
import { mobileProvider, walletConnectConfigured } from "./walletconnect";
export default function WalletConnector({ account, disabled, onConnected }) {
  const dialog = useRef(null),
    attempt = useRef(null),
    [options, setOptions] = useState(walletOptions),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [qr, setQr] = useState(""),
    [uri, setUri] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const unsubscribe = watchWallets(() => setOptions(walletOptions()));
    return () => {
      unsubscribe();
      attempt.current?.abort();
    };
  }, []);
  function open() {
    setError("");
    dialog.current.showModal();
    discoverWallets();
    setOptions(walletOptions());
  }
  function close() {
    attempt.current?.abort();
    attempt.current = null;
    setPending("");
    setQr("");
    setUri("");
    dialog.current.close();
  }
  async function choose(option) {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(option.name);
    setError("");
    setQr("");
    setUri("");
    setCopied(false);
    let mobile;
    try {
      if (option.mobile) {
        mobile = await mobileProvider(async (link) => {
          if (controller.signal.aborted) return;
          setUri(link);
          const { default: QRCode } = await import("qrcode");
          const image = await QRCode.toDataURL(link, { width: 280, margin: 2 });
          if (!controller.signal.aborted) setQr(image);
        }, controller.signal);
        option = { ...option, provider: mobile.provider };
      }
      const address = await connect(option, { signal: controller.signal });
      if (controller.signal.aborted) return;
      attempt.current = null;
      dialog.current.close();
      onConnected(address, option.name);
    } catch (e) {
      if (!controller.signal.aborted) setError(walletError(e));
    } finally {
      mobile?.cleanup();
      if (controller.signal.aborted && mobile?.provider.session)
        mobile.provider.disconnect().catch(() => {});
      if (attempt.current === controller) {
        attempt.current = null;
        setPending("");
      } else if (!controller.signal.aborted) setPending("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      setError("Could not copy. Scan the QR code with your wallet instead.");
    }
  }
  return (
    <>
      <button disabled={disabled} onClick={open}>
        {account
          ? account.slice(0, 6) + "…" + account.slice(-4)
          : "Connect wallet"}
      </button>
      <dialog
        ref={dialog}
        className="wallet-dialog"
        aria-labelledby="wallet-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="wallet-dialog-head">
          <h2 id="wallet-title">Connect a wallet</h2>
          <button aria-label="Close wallet selection" onClick={close}>
            ×
          </button>
        </div>
        <p>
          Choose a browser wallet, or connect a mobile wallet with
          WalletConnect.
        </p>
        {options.map((option) => (
          <button
            className="wallet-option"
            disabled={!!pending}
            key={option.id}
            onClick={() => choose(option)}
          >
            {option.name}
            <span>↗</span>
          </button>
        ))}
        {!options.length && (
          <div className="notice">
            No browser wallet detected. Enable an Ethereum-compatible extension
            for this site, or open this page in your wallet's browser.
          </div>
        )}
        <button
          className="wallet-option"
          disabled={!!pending}
          onClick={() => choose({ name: "WalletConnect", mobile: true })}
        >
          WalletConnect <span>Mobile / QR code</span>
        </button>
        {!walletConnectConfigured && (
          <p className="hint">
            Mobile connections are being configured. Browser wallets are
            available now.
          </p>
        )}
        {pending && (
          <div className="notice" role="status">
            {pending === "WalletConnect"
              ? "Open WalletConnect in your mobile wallet to scan or paste the connection link."
              : "Waiting for " +
                pending +
                ". Open your wallet extension, unlock it and approve the connection."}{" "}
            This does not send a transaction.
          </div>
        )}
        {qr && (
          <div className="wallet-qr">
            <img
              src={qr}
              width="280"
              height="280"
              alt="WalletConnect connection QR code"
            />
            <button onClick={copy}>
              {copied ? "Connection link copied" : "Copy connection link"}
            </button>
            <p className="hint">
              On this phone, copy the link and paste it into your wallet's
              WalletConnect screen.
            </p>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="wallet-actions">
          <button
            className="wallet-rescan"
            disabled={!!pending}
            onClick={discoverWallets}
          >
            Search again
          </button>
          {account && (
            <button
              className="wallet-rescan"
              disabled={!!pending}
              onClick={async () => {
                try {
                  await disconnectWallet();
                  close();
                } catch (e) {
                  setError(walletError(e));
                }
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
