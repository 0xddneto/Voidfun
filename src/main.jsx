import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatEther, parseEther } from "viem";
import {
  deployment,
  read,
  query,
  connect,
  execute,
  direct,
  confirmed,
} from "./web3";
import "./style.css";
const num = (x, d = 4) =>
  Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
const eth = (x) => num(formatEther(x ?? 0n), 7);
const dollars = (x) => "$" + num(x, 2);
const short = (x) => (x ? x.slice(0, 6) + "…" + x.slice(-4) : "");
function App() {
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
    [toll, setToll] = useState(0n),
    [balance, setBalance] = useState(0n),
    [earned, setEarned] = useState(0n);
  async function refresh() {
    if (!deployment.gateway) {
      setLoading(false);
      return;
    }
    try {
      const oneDollar = await read(deployment.price, "NativePrice", "quote", [
        parseEther("1"),
      ]);
      setEthUsd(1 / Number(formatEther(oneDollar)));
      const count = await query("launchCount");
      const addresses = await query("launches", [
        count > 30n ? count - 30n : 0n,
        30n,
      ]);
      const rows = [];
      for (const address of addresses) {
        const fields = await Promise.all(
          [
            "token",
            "creator",
            "realReserve",
            "trackedTokens",
            "reservedTokens",
            "supply",
            "phantomQuote",
            "complete",
            "feeBps",
            "protocolShareBps",
          ].map((fn) => read(address, "LaunchCurve", fn)),
        );
        const [
          token,
          creator,
          reserve,
          tracked,
          reserved,
          supply,
          phantom,
          complete,
          feeBps,
          share,
        ] = fields;
        const [n, s] = await Promise.all([
          read(token, "LaunchToken", "name"),
          read(token, "LaunchToken", "symbol"),
        ]);
        rows.push({
          address,
          token,
          creator,
          reserve,
          tracked,
          reserved,
          supply,
          phantom,
          complete,
          feeBps,
          share,
          name: n,
          symbol: s,
          fdv: Number(formatEther(((phantom + reserve) * supply) / tracked)),
          progress:
            Number(((supply - tracked) * 10000n) / (supply - reserved)) / 100,
        });
      }
      setList(rows.reverse());
      setSelected((previous) =>
        previous
          ? (rows.find((r) => r.address === previous.address) ?? previous)
          : previous,
      );
      const fee = await read(
        deployment.implementation,
        "Voidfun",
        "CREATE_FEE",
      );
      const trade = await read(
        deployment.implementation,
        "Voidfun",
        "TRADE_FEE_BPS",
      );
      const share = await read(
        deployment.implementation,
        "Voidfun",
        "PROTOCOL_SHARE_BPS",
      );
      setTerms({ fee, trade, share });
      setError("");
    } catch (e) {
      setError(e.shortMessage ?? e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    window.ethereum
      ?.request({ method: "eth_accounts" })
      .then((a) => setAccount(a[0]))
      .catch(() => {});
    const handler = (a) => {
      setAccount(a[0]);
      setQuote();
    };
    window.ethereum?.on?.("accountsChanged", handler);
    const hash = localStorage.getItem("voidfun-pending");
    if (hash) confirmed(hash, setStatus).catch(() => {});
    return () => window.ethereum?.removeListener?.("accountsChanged", handler);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    setQuote();
    setBalance(0n);
    setEarned(0n);
    if (!selected) return;
    Promise.all([
      read(deployment.runtime, "Runtime", "quote", [1n]),
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
    if (!selected || selected.complete || !amount) return;
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
    await execute(
      "createToken",
      [name.trim(), symbol.trim().toUpperCase(), uri.trim()],
      terms.fee,
      user,
      setStatus,
    );
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
          <span className="network">● RH TESTNET</span>
          <button
            disabled={busy}
            onClick={() => run(async () => setAccount(await connect()))}
          >
            {account ? short(account) : "Connect wallet"}
          </button>
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
            Deployment is being prepared. Wallet transactions are disabled.
          </div>
        )}
        {view === "explore" && !selected && (
          <>
            <section className="hero">
              <div>
                <div className="eyebrow">BUILT ON DEED 0001</div>
                <h1>
                  Small beginnings.
                  <br />
                  <em>Big possibilities.</em>
                </h1>
                <p>
                  Launch a token. Let the curve do the pricing.
                  <br />
                  An open start on Robinhood Chain.
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
                <p className="hint">Showing the latest 30 launches.</p>
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
                        <strong>{eth(r.reserve)} ETH</strong>
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
                    : "Create a token and start its journey on Deed 0001."}
                </p>
                {!search && (
                  <button onClick={() => setView("create")}>
                    Launch the first token ↗
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {view === "create" && (
          <section className="create-layout">
            <div>
              <div className="eyebrow">YOUR IDEA, ON CHAIN</div>
              <h1>Start something.</h1>
              <p>
                Give your token a name. Its price starts from a $3,000 fully
                diluted valuation reference and moves with buys and sells.
              </p>
              <div className="notice">
                $3,000 is a pricing reference, not money deposited. The real
                reserve starts at zero.
              </div>
              <p>
                No opening penalty or waiting list. Earlier purchases get the
                earlier curve price.
              </p>
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
                    {terms ? eth(terms.fee) + " ETH" : "Pending configuration"}
                  </dd>
                </div>
                <div>
                  <dt>Trading fee</dt>
                  <dd>
                    {terms
                      ? Number(terms.trade) / 100 + "%"
                      : "Pending configuration"}
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
                disabled={busy || !deployment.gateway || !terms || !accepted}
              >
                Create token ↗
              </button>
            </form>
          </section>
        )}
        {view === "explore" && selected && (
          <>
            <button className="back" onClick={() => setSelected()}>
              ← All tokens
            </button>
            <section className="trade-layout">
              <div>
                <div className="eyebrow">DEED 0001 / ROBINHOOD TESTNET</div>
                <h1>{selected.name}</h1>
                <p className="ticker">${selected.symbol}</p>
                <a
                  href={deployment.explorer + "/token/" + selected.token}
                  target="_blank"
                  rel="noreferrer"
                >
                  Token {short(selected.token)} ↗
                </a>
                <div className="metrics">
                  <div>
                    <small>Fully diluted valuation</small>
                    <strong>{dollars(selected.fdv * ethUsd)}</strong>
                  </div>
                  <div>
                    <small>Real reserve</small>
                    <strong>{eth(selected.reserve)} ETH</strong>
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
                  Valuation uses the current ETH/USD quote. It does not
                  represent available liquidity. At 80% of supply sold, this
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
                    <dd>{eth(earned)} ETH</dd>
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
                  {side === "buy" ? "Spend ETH" : "Sell " + selected.symbol}
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
                          (side === "buy" ? selected.symbol : "ETH")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>App trading fee ({Number(selected.feeBps) / 100}%)</dt>
                    <dd>
                      {quote && !quote.error ? eth(quote.fee) + " ETH" : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Deed toll · separate</dt>
                    <dd>{eth(toll)} ETH</dd>
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
                    : "If the final purchase exceeds the curve limit, the unused ETH is returned in the same transaction."}
                </p>
                {quote?.error && <p className="error">{quote.error}</p>}
                <button
                  className="primary wide"
                  disabled={
                    busy ||
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
      </main>
      <footer>
        <a
          className="brand"
          href="#"
          onClick={() => {
            setView("explore");
            setSelected();
          }}
        >
          void<span>fun</span>
        </a>
        <span>
          Built on{" "}
          <a href="https://www.voidchains.app" target="_blank" rel="noreferrer">
            VoidChains
          </a>{" "}
          · Deed 0001
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
createRoot(document.getElementById("root")).render(<App />);
