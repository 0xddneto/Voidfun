import CurveChart from "./CurveChart";
import { decodeEventLog } from "viem";
import WalletConnector from "./WalletConnector";
import { watchAccount } from "./wallets";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { marketSnapshot, invalidateMarket } from "./market-data";
import { pendingTransaction } from "./transactions";
import { createRoot } from "react-dom/client";
import { formatEther, parseEther } from "viem";
import { networks, createNetworkContext } from "./web3";
import "./style.css";
const num = (x, d = 4) =>
  Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
const eth = (x) => num(formatEther(x ?? 0n), 7);
const dollars = (x) => (Number.isFinite(x) ? "$" + num(x, 2) : "—");
const short = (x) => (x ? x.slice(0, 6) + "…" + x.slice(-4) : "");
function App({ network, onNetworkChange }) {
  const context = useMemo(() => createNetworkContext(network), [network]);
  const {
    deployment,
    nativeSymbol,
    read,
    query,
    connect,
    execute,
    direct,
    confirmed,
    abis,
    wallet,
  } = context;
  const [account, setAccount] = useState(),
    [view, setView] = useState("explore"),
    [list, setList] = useState([]),
    [selected, setSelected] = useState(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [status, setStatus] = useState(),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [ethUsd, setEthUsd] = useState(0),
    [terms, setTerms] = useState(),
    [name, setName] = useState(""),
    [symbol, setSymbol] = useState(""),
    [uri, setUri] = useState(""),
    [accepted, setAccepted] = useState(false),
    [side, setSide] = useState("buy"),
    [amount, setAmount] = useState(""),
    [quote, setQuote] = useState(),
    [toll, setToll] = useState(null),
    [balance, setBalance] = useState(0n),
    [earned, setEarned] = useState(0n);
  const [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [snapshotAt, setSnapshotAt] = useState("");
  const [registered, setRegistered] = useState(Boolean(deployment.gateway));
  const refreshRunning = useRef(null),
    alive = useRef(true),
    generation = useRef(0);
  async function changeNetwork(id) {
    const target = networks.find((n) => n.chainId === Number(id));
    if (!target || busy) return;
    setBusy(true);
    try {
      if (account) await wallet(account, target);
      const url = new URL(window.location.href);
      url.searchParams.set("chain", String(target.chainId));
      url.hash = "";
      window.history.replaceState(null, "", url.href);
      onNetworkChange(target);
    } catch (e) {
      setStatus({ kind: "error", text: e.shortMessage ?? e.message });
      setBusy(false);
    }
  }
  async function refresh() {
    const wanted = window.location.hash.startsWith("#token/")
      ? window.location.hash.slice(7)
      : undefined;
    const key = `${offset}:${wanted ?? ""}`;
    if (refreshRunning.current?.key === key) return refreshRunning.current.task;
    const version = ++generation.current;
    const task = (async () => {
      try {
        const data = await marketSnapshot(deployment, offset, wanted);
        if (!alive.current || version !== generation.current) return;
        setTerms(data.terms);
        setRegistered(Boolean(data.published));
        setList(data.rows);
        setHasMore(data.hasMore);
        setSnapshotAt(data.generatedAt);
        setEthUsd(data.ethUsd ?? NaN);
        setSelected(
          (previous) =>
            data.selected ??
            data.rows.find(
              (row) =>
                row.address.toLowerCase() === previous?.address?.toLowerCase(),
            ) ??
            previous,
        );
        setError(
          data.stale
            ? "Connection interrupted. Showing the last confirmed market snapshot."
            : data.priceUnavailable
              ? "USD reference is temporarily unavailable. Native currency amounts remain visible."
              : "",
        );
      } catch (e) {
        if (alive.current && version === generation.current)
          setError(e.shortMessage ?? e.message);
      } finally {
        if (version === generation.current) {
          refreshRunning.current = null;
          if (alive.current) setLoading(false);
        }
      }
    })();
    refreshRunning.current = { key, task };
    return task;
  }
  useEffect(() => {
    const unsubscribe = watchAccount((address) => {
      setAccount(address);
      setQuote();
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    let checking = false;
    const check = async () => {
      const record = pendingTransaction(deployment.chainId, account);
      if (!record || checking || busy || document.visibilityState === "hidden")
        return;
      checking = true;
      try {
        const receipt = await confirmed(record, setStatus, true);
        if (receipt) {
          invalidateMarket();
          await refresh();
        }
      } catch {
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(check, 10000);
    return () => clearInterval(timer);
  }, [account, busy]);
  useEffect(() => {
    alive.current = true;
    const poll = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine)
        void refresh();
    };
    poll();
    const timer = setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    window.addEventListener("hashchange", poll);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
      window.removeEventListener("hashchange", poll);
    };
  }, [offset]);
  useEffect(() => {
    let live = true;
    setQuote();
    setToll(null);
    setBalance(0n);
    setEarned(0n);
    if (!selected?.token) return;
    Promise.all([
      read(deployment.runtime, "DeedRuntime", "quote", []),
      account
        ? read(selected.token, "LaunchToken", "balanceOf", [account])
        : 0n,
      account
        ? read(selected.address, "LaunchCurve", "claimable", [account])
        : 0n,
    ])
      .then(([t, b, e]) => {
        if (live) {
          setToll(t[0]);
          setBalance(b);
          setEarned(e);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [selected, account]);
  useEffect(() => {
    setQuote();
    if (!selected?.token || selected.complete || !amount) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const n = parseEther(amount);
        if (n <= 0n) return;
        const result = await read(
          selected.address,
          "LaunchCurve",
          side === "buy" ? "quoteBuy" : "quoteSell",
          [n],
        );
        if (live)
          setQuote({
            amount: n,
            out: result[0],
            spent: side === "buy" ? result[1] : 0n,
            fee: side === "buy" ? result[2] : result[1],
            at: Date.now(),
          });
      } catch (e) {
        if (live)
          setQuote({ error: e.shortMessage ?? "Cannot quote this amount." });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [amount, side, selected]);
  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setStatus();
    try {
      await fn();
      invalidateMarket();
      await refresh();
    } catch (e) {
      setStatus((old) =>
        old?.hash
          ? { ...old, text: e.shortMessage ?? e.message }
          : { kind: "error", text: e.shortMessage ?? e.message },
      );
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    for (const [value, max, label] of [
      [name.trim(), 64, "Name"],
      [symbol.trim().toUpperCase(), 12, "Ticker"],
      [uri.trim(), 512, "Metadata URL"],
    ]) {
      if (new TextEncoder().encode(value).length > max)
        throw Error(label + " exceeds " + max + " UTF-8 bytes.");
    }
    const user = await connect();
    setAccount(user);
    const receipt = await execute(
      "createToken",
      [name.trim(), symbol.trim().toUpperCase(), uri.trim()],
      terms.fee,
      user,
      setStatus,
    );
    const launched = receipt.logs
      .filter(
        (log) => log.address.toLowerCase() === deployment.gateway.toLowerCase(),
      )
      .map((log) => {
        try {
          return decodeEventLog({ abi: abis.Voidfun, ...log });
        } catch {
          return null;
        }
      })
      .find((event) => event?.eventName === "Launched");
    if (launched) {
      setSelected({ address: launched.args.curve });
      window.location.hash = "token/" + launched.args.curve;
    }
    setView("explore");
    setName("");
    setSymbol("");
    setUri("");
    setAccepted(false);
  }
  async function trade() {
    if (!quote || quote.error || Date.now() - quote.at > 30000)
      throw Error("Refresh the quote before trading.");
    const user = await connect();
    setAccount(user);
    const minimum = (quote.out * 99n) / 100n;
    if (side === "buy")
      await execute(
        "buy",
        [selected.address, minimum],
        quote.amount,
        user,
        setStatus,
      );
    else {
      const allowed = await read(selected.token, "LaunchToken", "allowance", [
        user,
        selected.address,
      ]);
      if (allowed < quote.amount) {
        await direct(
          "LaunchToken",
          selected.token,
          "approve",
          [selected.address, quote.amount],
          user,
          setStatus,
        );
        setStatus({
          text: "Token amount approved. Review the current quote and click Sell.",
        });
        return;
      }
      await execute(
        "sell",
        [selected.address, quote.amount, minimum],
        0n,
        user,
        setStatus,
      );
    }
    setAmount("");
    setQuote();
  }
  const visible = list.filter((r) =>
    (r.name + " " + r.symbol + " " + r.token)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="app">
      <header>
        <a
          className="brand"
          href="#"
          onClick={() => {
            setView("explore");
            setSelected();
            window.location.hash = "";
          }}
        >
          void<span>fun</span>
          <i>✳</i>
        </a>
        <nav>
          <button
            className={view === "explore" ? "active" : ""}
            onClick={() => {
              setView("explore");
              setSelected();
              window.location.hash = "";
            }}
          >
            Explore
          </button>
          <button
            className={view === "create" ? "active" : ""}
            onClick={() => setView("create")}
          >
            Create a token
          </button>
        </nav>
        <div className="wallet">
          <label className="network">
            Network{" "}
            <select
              aria-label="Execution network"
              value={deployment.chainId}
              disabled={busy}
              onChange={(e) => changeNetwork(e.target.value)}
            >
              {networks.map((n) => (
                <option key={n.chainId} value={n.chainId}>
                  {n.chainName}
                </option>
              ))}
            </select>
          </label>
          <WalletConnector
            account={account}
            disabled={busy}
            onConnected={(address, name) => {
              setAccount(address);
              setStatus({
                kind: "success",
                text: name + " connected: " + short(address),
              });
            }}
          />
        </div>
      </header>
      <div className="test-banner">
        TESTNET ONLY · No real-money launch. Curves stop at completion; Uniswap
        pools are not created in this version.
      </div>
      <main>
        {error && (
          <div className="notice error">
            Network data unavailable: {error}
            <button onClick={refresh}>Retry</button>
          </div>
        )}
        {!deployment.gateway && (
          <div className="notice">
            Publish Voidfun manually on {deployment.chainName} through the
            protocol Build page. Token creation opens on this network after
            publication. Implementation:{" "}
            {deployment.implementation || "Preparing"}.
          </div>
        )}
        {deployment.gateway && !registered && (
          <div className="notice">
            This application is not currently registered. New launches and
            trades are unavailable; earned fee claims remain accessible.
          </div>
        )}
        {view === "explore" && !selected && (
          <>
            <section className="hero">
              <div>
                <div className="eyebrow">
                  {deployment.chainName.toUpperCase()} / VOIDFUN
                </div>
                <h1>
                  Small beginnings.
                  <br />
                  <em>Big possibilities.</em>
                </h1>
                <p>
                  Launch a token. Let the curve do the pricing.
                  <br />
                  An open start on {deployment.chainName}.
                </p>
                <button className="primary" onClick={() => setView("create")}>
                  Create your token <span>↗</span>
                </button>
              </div>
              <div className="orbit">
                <div className="orbit-inner">✳</div>
                <span className="orbit-label">YOUR NEXT IDEA / VOIDFUN</span>
              </div>
            </section>
            <div className="section-head">
              <div>
                <span className="eyebrow">THE LAUNCH FLOOR</span>
                <h2>Fresh on the curve</h2>
                <p className="hint">
                  Newest first · page {Math.floor(offset / 24) + 1}. Search this
                  page.
                </p>
              </div>
              <input
                aria-label="Search tokens"
                placeholder="Search name, ticker or address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {loading ? (
              <div className="empty">Reading the launchpad…</div>
            ) : visible.length ? (
              <div className="grid">
                {visible.map((r) => (
                  <button
                    className="token-card"
                    key={r.address}
                    onClick={() => {
                      setSelected(r);
                      window.location.hash = "token/" + r.address;
                      setSide("buy");
                      setAmount("");
                    }}
                  >
                    <div className="token-top">
                      <div className="coin">{r.symbol.slice(0, 2)}</div>
                      <span className="badge">
                        {r.complete ? "COMPLETE · NO POOL" : "ON THE CURVE"}
                      </span>
                    </div>
                    <h3>{r.name}</h3>
                    <span className="ticker">${r.symbol}</span>
                    <div className="token-stats">
                      <div>
                        <small>FDV / valuation</small>
                        <strong>{dollars(r.fdv * ethUsd)}</strong>
                      </div>
                      <div>
                        <small>Real reserve</small>
                        <strong>
                          {eth(r.reserve)} {nativeSymbol}
                        </strong>
                      </div>
                    </div>
                    <div className="progress">
                      <i style={{ width: r.progress + "%" }} />
                    </div>
                    <div className="card-bottom">
                      <span>{num(r.progress, 1)}% of curve</span>
                      <span>Trade ↗</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">✳</div>
                <h3>
                  {search
                    ? "No matching tokens."
                    : "The first idea could be yours."}
                </h3>
                <p>
                  {search
                    ? "Try another name or ticker."
                    : "Create a token and start its journey."}
                </p>
                {!search && (
                  <button onClick={() => setView("create")}>
                    Launch the first token ↗
                  </button>
                )}
              </div>
            )}
            {(offset > 0 || hasMore) && (
              <div className="section-head" aria-label="Token pages">
                <button
                  disabled={offset === 0 || loading}
                  onClick={() => {
                    setLoading(true);
                    setOffset(Math.max(0, offset - 24));
                  }}
                >
                  ← Newer tokens
                </button>
                <button
                  disabled={!hasMore || loading}
                  onClick={() => {
                    setLoading(true);
                    setOffset(offset + 24);
                  }}
                >
                  Older tokens →
                </button>
              </div>
            )}
          </>
        )}
        {view === "create" && (
          <section className="create-layout">
            <div>
              <div className="eyebrow">YOUR IDEA, ON CHAIN</div>
              <h1>Start something.</h1>
            </div>
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                run(launch);
              }}
            >
              <h2>Create a token</h2>
              <label>
                Token name
                <input
                  required
                  maxLength={64}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your next idea"
                />
              </label>
              <label>
                Ticker
                <input
                  required
                  maxLength={12}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="IDEA"
                />
              </label>
              <label>
                Metadata URL · optional
                <input
                  type="url"
                  maxLength={512}
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <dl>
                <div>
                  <dt>Fixed supply</dt>
                  <dd>1 billion tokens</dd>
                </div>
                <div>
                  <dt>Tokens offered on the curve</dt>
                  <dd>80%</dd>
                </div>
                <div>
                  <dt>Creation fee</dt>
                  <dd>
                    {terms
                      ? eth(terms.fee) + " " + nativeSymbol
                      : deployment.implementation
                        ? "Loading…"
                        : "Implementation pending"}
                  </dd>
                </div>
                <div>
                  <dt>Trading fee</dt>
                  <dd>
                    {terms
                      ? Number(terms.trade) / 100 + "%"
                      : deployment.implementation
                        ? "Loading…"
                        : "Implementation pending"}
                  </dd>
                </div>
              </dl>
              <p className="hint">
                Voidfun fees are separate from the Deed toll and network gas.
                The wallet shows the total before signing.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I understand this test stops all buying and selling when the
                curve completes. Reserves and remaining tokens stay in the
                contract; no pool or withdrawal follows.
              </label>
              <button
                className="primary wide"
                disabled={busy || !registered || !terms || !accepted}
              >
                Create token ↗
              </button>
            </form>
          </section>
        )}
        {view === "explore" && selected?.token && (
          <>
            <button
              className="back"
              onClick={() => {
                setSelected();
                window.location.hash = "";
              }}
            >
              ← All tokens
            </button>
            <section className="trade-layout">
              <div>
                <div className="eyebrow">
                  DEED {deployment.deedId.padStart(4, "0")} /{" "}
                  {deployment.chainName.toUpperCase()}
                </div>
                <h1>{selected.name}</h1>
                <p className="ticker">${selected.symbol}</p>
                <a
                  href={deployment.explorer + "/token/" + selected.token}
                  target="_blank"
                  rel="noreferrer"
                >
                  Token {short(selected.token)} ↗
                </a>
                <CurveChart
                  key={selected.address}
                  curve={selected}
                  ethUsd={ethUsd}
                  context={context}
                />
                <div className="metrics">
                  <div>
                    <small>Fully diluted valuation</small>
                    <strong>{dollars(selected.fdv * ethUsd)}</strong>
                  </div>
                  <div>
                    <small>Real reserve</small>
                    <strong>
                      {eth(selected.reserve)} {nativeSymbol}
                    </strong>
                  </div>
                  <div>
                    <small>Curve progress</small>
                    <strong>{num(selected.progress, 2)}%</strong>
                  </div>
                </div>
                <div className="progress large">
                  <i style={{ width: selected.progress + "%" }} />
                </div>
                <p className="hint">
                  Valuation uses the current {nativeSymbol}/USD quote. It does
                  not represent available liquidity. At 80% of supply sold, this
                  test closes trading.
                </p>
                <div className="notice">
                  {selected.complete
                    ? "Curve completed. Buying and selling are closed. No Uniswap pool was created."
                    : "This test does not migrate to a pool. Do not buy expecting trading or withdrawals after completion."}
                </div>
                <dl>
                  <div>
                    <dt>Your tokens</dt>
                    <dd>
                      {num(formatEther(balance), 4)} {selected.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Your claimable fees</dt>
                    <dd>
                      {eth(earned)} {nativeSymbol}
                    </dd>
                  </div>
                </dl>
                {earned > 0n && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const user = await connect();
                        await direct(
                          "LaunchCurve",
                          selected.address,
                          "claim",
                          [user],
                          user,
                          setStatus,
                        );
                      })
                    }
                  >
                    Claim your fees ↗
                  </button>
                )}
              </div>
              <div className="panel">
                <div className="tabs">
                  {["buy", "sell"].map((s) => (
                    <button
                      key={s}
                      className={side === s ? "active" : ""}
                      disabled={busy}
                      onClick={() => {
                        setSide(s);
                        setAmount("");
                      }}
                    >
                      {s === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>
                <label>
                  {side === "buy"
                    ? "Spend " + nativeSymbol
                    : "Sell " + selected.symbol}
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    disabled={selected.complete || busy}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <dl>
                  <div>
                    <dt>Estimated output</dt>
                    <dd>
                      {quote && !quote.error
                        ? eth(quote.out) +
                          " " +
                          (side === "buy" ? selected.symbol : nativeSymbol)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>App trading fee ({Number(selected.feeBps) / 100}%)</dt>
                    <dd>
                      {quote && !quote.error
                        ? eth(quote.fee) + " " + nativeSymbol
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Deed toll · separate</dt>
                    <dd>
                      {toll === null
                        ? "Updating…"
                        : `${eth(toll)} ${nativeSymbol}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Network gas</dt>
                    <dd>Shown by wallet</dd>
                  </div>
                </dl>
                <p className="hint">
                  Minimum received: 99% of the quoted output.{" "}
                  {side === "sell"
                    ? "A token approval may be required first; it is limited to this sale amount."
                    : "If the final purchase exceeds the curve limit, the unused native currency is returned in the same transaction."}
                </p>
                {quote?.error && <p className="error">{quote.error}</p>}
                <button
                  className="primary wide"
                  disabled={
                    busy ||
                    !registered ||
                    selected.complete ||
                    !quote ||
                    !!quote.error ||
                    quote.out === 0n
                  }
                  onClick={() => run(trade)}
                >
                  {selected.complete
                    ? "Trading closed"
                    : busy
                      ? "Processing…"
                      : side === "buy"
                        ? "Buy " + selected.symbol + " ↗"
                        : "Approve / sell " + selected.symbol + " ↗"}
                </button>
              </div>
            </section>
          </>
        )}
        {snapshotAt && (
          <p className="hint">
            Market updated {new Date(snapshotAt).toLocaleTimeString()} · quotes
            are checked again before signing.
          </p>
        )}
      </main>
      <footer>
        <a
          className="brand"
          href="#"
          onClick={() => {
            setView("explore");
            setSelected();
            window.location.hash = "";
          }}
        >
          void<span>fun</span>
        </a>
        <span>
          Built on{" "}
          <a href="https://voiddeeds.xyz" target="_blank" rel="noreferrer">
            Voiddeeds
          </a>{" "}
          ·{" "}
          {deployment.gateway
            ? `Deed ${deployment.deedId.padStart(4, "0")}`
            : "Awaiting manual publication"}
        </span>
        <span>Test tokens. Real curiosity.</span>
      </footer>
      {status && (
        <div className={"toast " + (status.kind ?? "")} role="status">
          <button aria-label="Dismiss notification" onClick={() => setStatus()}>
            ×
          </button>
          <strong>{status.text}</strong>
          {status.hash && (
            <a
              href={deployment.explorer + "/tx/" + status.hash}
              target="_blank"
              rel="noreferrer"
            >
              View transaction {short(status.hash)} ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
function NetworkApp() {
  const [network, setNetwork] = useState(
    () =>
      networks.find(
        (n) =>
          n.chainId ===
          Number(new URLSearchParams(window.location.search).get("chain")),
      ) ?? networks[0],
  );
  return (
    <App key={network.chainId} network={network} onNetworkChange={setNetwork} />
  );
}
createRoot(document.getElementById("root")).render(<NetworkApp />);
