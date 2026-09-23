import React, { useEffect, useState } from "react";
import { formatEther } from "viem";

const cache = new Map();
export default function CurveChart({ curve, ethUsd, context }) {
  const { deployment, nativeSymbol } = context;
  const cacheKey = `${deployment.chainId}:${deployment.gateway}:${curve.address}`;
  const [mode, setMode] = useState("curve"),
    [history, setHistory] = useState([]),
    [error, setError] = useState(""),
    [hover, setHover] = useState(null);
  const [before, setBefore] = useState(),
    [older, setOlder] = useState(null),
    [reading, setReading] = useState(false);
  useEffect(() => {
    if (!curve.token) return;
    let live = true,
      running = false;
    async function load() {
      if (running || document.visibilityState === "hidden" || !navigator.onLine)
        return;
      running = true;
      setReading(true);
      const key = cacheKey + ":" + (before ?? "latest");
      try {
        const p = new URLSearchParams({
          chain: String(deployment.chainId),
          curve: curve.address,
        });
        if (before !== undefined) p.set("before", before);
        const response = await fetch("/api/history?" + p, {
          signal: AbortSignal.timeout(45000),
        });
        const data = JSON.parse(await response.text(), (key, value) =>
          ["quote", "reserve", "tokenReserve", "blockNumber"].includes(key) &&
          typeof value === "string" &&
          /^\d+$/.test(value)
            ? BigInt(value)
            : value,
        );
        if (!response.ok) throw Error(data.error);
        cache.set(key, data);
        if (live) {
          setHistory(data.logs);
          setOlder(data.before);
          setError(
            data.stale
              ? "Showing cached history while the network recovers."
              : "",
          );
        }
      } catch {
        const saved = cache.get(key);
        if (live) {
          if (saved) {
            setHistory(saved.logs);
            setOlder(saved.before);
          }
          setError("Trade history is temporarily unavailable.");
        }
      } finally {
        running = false;
        if (live) setReading(false);
      }
    }
    void load();
    const timer = setInterval(load, 30000);
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [cacheKey, before]);
  const hasUsd = Number.isFinite(ethUsd) && ethUsd > 0;
  const currency = hasUsd ? "USD" : nativeSymbol;
  const rate = hasUsd ? ethUsd : 1;
  const displayPrice = (value) =>
    Number(value).toLocaleString("en-US", { maximumSignificantDigits: 5 }) +
    " " +
    currency;
  const pricedHistory = history.map((log) => ({
    ...log,
    price:
      Number(
        formatEther(
          ((curve.phantom + log.args.reserve) * 10n ** 18n) /
            log.args.tokenReserve,
        ),
      ) * rate,
  }));
  const supply = Number(formatEther(curve.supply)),
    tracked = Number(formatEther(curve.tracked)),
    quote = Number(formatEther(curve.phantom + curve.reserve)),
    k = tracked * quote,
    currentPrice = (quote / tracked) * rate,
    sold = ((supply - tracked) / supply) * 100;
  const points =
    mode === "curve"
      ? Array.from({ length: 81 }, (_, i) => ({
          x: i,
          y: (k / (supply * (1 - i / 100)) ** 2) * rate,
        }))
      : pricedHistory.map((trade, i) => ({ x: i, y: trade.price }));
  const max = Math.max(...points.map((p) => p.y), currentPrice) * 1.08,
    min =
      mode === "curve"
        ? 0
        : Math.min(...points.map((p) => p.y), currentPrice) * 0.92;
  const width = 680,
    height = 300,
    left = 74,
    right = 20,
    top = 22,
    bottom = 38,
    plotW = width - left - right,
    plotH = height - top - bottom;
  const x = (value) =>
      left +
      (value / (mode === "curve" ? 80 : Math.max(1, points.length - 1))) *
        plotW,
    y = (value) => top + ((max - value) / (max - min || 1)) * plotH;
  const line = points
    .map((p, i) => (i ? "L" : "M") + x(p.x) + "," + y(p.y))
    .join(" ");
  const current = { x: sold, y: currentPrice };
  const tip = hover === null ? null : points[hover];
  return (
    <section className="chart-panel" aria-label="Token chart">
      <div className="chart-heading">
        <div>
          <small>Token price</small>
          <strong>{displayPrice(currentPrice)}</strong>
        </div>
        <div className="chart-tabs">
          <button
            className={mode === "curve" ? "active" : ""}
            onClick={() => {
              setMode("curve");
              setHover(null);
            }}
          >
            Bonding curve
          </button>
          <button
            className={mode === "history" ? "active" : ""}
            onClick={() => {
              setMode("history");
              setHover(null);
            }}
          >
            Trades
          </button>
        </div>
      </div>
      {mode === "history" && history.length === 0 ? (
        <div className="chart-empty">
          {error ||
            (reading
              ? "Loading confirmed trades…"
              : "No trades in this block range. Use Older trades to explore earlier activity.")}
        </div>
      ) : (
        <svg
          viewBox={"0 0 " + width + " " + height}
          role="img"
          aria-label={
            mode === "curve"
              ? "Bonding curve price by percentage of supply sold"
              : "Price after confirmed trades"
          }
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relative = ((event.clientX - rect.left) * width) / rect.width;
            setHover(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(((relative - left) / plotW) * (points.length - 1)),
                ),
              ),
            );
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const val = min + ((max - min) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(val)}
                  y2={y(val)}
                  stroke="#e0e5d6"
                />
                <text x={left - 8} y={y(val) + 4} textAnchor="end">
                  {displayPrice(val)}
                </text>
              </g>
            );
          })}
          <path
            d={
              line +
              " L " +
              x(points.at(-1)?.x ?? 0) +
              "," +
              (height - bottom) +
              " L " +
              left +
              "," +
              (height - bottom) +
              " Z"
            }
            fill="#d5edac"
            opacity=".35"
          />
          <path d={line} fill="none" stroke="#6d8e3a" strokeWidth="2.5" />
          {mode === "curve" && (
            <>
              <circle
                cx={x(current.x)}
                cy={y(current.y)}
                r="5"
                fill="#273d19"
              />
              <text
                x={Math.min(x(current.x) + 9, width - 100)}
                y={y(current.y) - 12}
              >
                Current price
              </text>
              {[0, 20, 40, 60, 80].map((v) => (
                <text key={v} x={x(v)} y={height - 15} textAnchor="middle">
                  {v}% sold
                </text>
              ))}
            </>
          )}
          {mode === "history" && history.length > 0 && (
            <>
              <circle
                cx={x(points.at(-1).x)}
                cy={y(points.at(-1).y)}
                r="4"
                fill="#273d19"
              />
              <text x={left} y={height - 15}>
                {new Date(history[0].time * 1000).toLocaleTimeString()}
              </text>
              <text x={width - right} y={height - 15} textAnchor="end">
                {new Date(history.at(-1).time * 1000).toLocaleTimeString()}
              </text>
            </>
          )}
          {tip && (
            <>
              <line
                x1={x(tip.x)}
                x2={x(tip.x)}
                y1={top}
                y2={height - bottom}
                stroke="#80966a"
                strokeDasharray="3 3"
              />
              <circle cx={x(tip.x)} cy={y(tip.y)} r="5" fill="#293d1c" />
              <text
                x={Math.max(left + 10, Math.min(x(tip.x), width - 110))}
                y={top + 12}
              >
                {displayPrice(tip.y)}
              </text>
            </>
          )}
        </svg>
      )}
      <p className="hint">
        {mode === "curve"
          ? "Price curve · dot marks the current position."
          : "Latest 60 confirmed trades in this block range."}
      </p>
      {error && <p className="hint">{error}</p>}
      {mode === "history" && (
        <div className="section-head">
          <button
            disabled={before === undefined || reading}
            onClick={() => setBefore(undefined)}
          >
            Latest trades
          </button>
          <button disabled={!older || reading} onClick={() => setBefore(older)}>
            Older trades
          </button>
        </div>
      )}
      {history.length > 0 && (
        <div className="trade-history">
          <h3>Recent trades</h3>
          <table>
            <thead>
              <tr>
                <th>Side</th>
                <th>{nativeSymbol}</th>
                <th>Trader</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {history
                .slice(-8)
                .reverse()
                .map((log) => (
                  <tr key={log.transactionHash + log.logIndex}>
                    <td className={log.args.buy ? "buy-text" : "sell-text"}>
                      {log.args.buy ? "Buy" : "Sell"}
                    </td>
                    <td>
                      {Number(formatEther(log.args.quote)).toLocaleString(
                        "en-US",
                        { maximumFractionDigits: 7 },
                      )}
                    </td>
                    <td>
                      {log.args.user.slice(0, 6) +
                        "…" +
                        log.args.user.slice(-4)}
                    </td>
                    <td>
                      <a
                        href={
                          deployment.explorer + "/tx/" + log.transactionHash
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        View ↗
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
