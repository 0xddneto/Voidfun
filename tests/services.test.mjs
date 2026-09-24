import { test } from "node:test";
import assert from "node:assert/strict";
import { cached } from "../shared/response-cache.js";
import {
  receiptState,
  savePending,
  pendingTransaction,
  clearPending,
} from "../src/transactions.js";
import {
  reviveMarket,
  marketSnapshot,
  invalidateMarket,
} from "../src/market-data.js";
import market from "../api/market.js";
import history from "../api/history.js";
const account = "0x" + "1".repeat(40),
  other = "0x" + "2".repeat(40),
  hash = "0x" + "a".repeat(64),
  blockHash = "0x" + "b".repeat(64);
const record = {
  chainId: 46630,
  account,
  hash,
  nonce: 4,
  to: other,
  data: "0x1234",
  value: "100",
};
const receipt = { blockNumber: 10n, blockHash, status: "success" };
function client(overrides = {}) {
  return {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 11n,
    getBlock: async () => ({ hash: blockHash }),
    ...overrides,
  };
}
test("only canonical receipts with two blocks are completed", async () => {
  assert.equal((await receiptState(client(), record)).kind, "success");
  assert.equal(
    (await receiptState(client({ getBlockNumber: async () => 10n }), record))
      .kind,
    "pending",
  );
  assert.equal(
    (
      await receiptState(
        client({ getBlock: async () => ({ hash: "0xother" }) }),
        record,
      )
    ).kind,
    "pending",
  );
  assert.equal(
    (
      await receiptState(
        client({
          getTransactionReceipt: async () => ({
            ...receipt,
            status: "reverted",
          }),
        }),
        record,
      )
    ).kind,
    "error",
  );
});
test("speed-up preserves operation; cancellation is never reported as successful purchase", async () => {
  for (const cancel of [false, true]) {
    const replacement = {
      from: account,
      nonce: 4,
      to: cancel ? account : other,
      input: cancel ? "0x" : record.data,
      value: cancel ? 0n : 100n,
      hash: "0x" + "c".repeat(64),
    };
    const c = client({
      getTransactionReceipt: async ({ hash: h }) => {
        if (h === hash) throw Error("Not found");
        return receipt;
      },
      getTransactionCount: async () => 5,
      getBlock: async ({ includeTransactions }) =>
        includeTransactions
          ? { transactions: [replacement] }
          : { hash: blockHash },
    });
    assert.equal(
      (await receiptState(c, record)).kind,
      cancel ? "replaced" : "success",
    );
  }
});
test("unresolved nonce remains pending and RPC failure does not create success", async () => {
  assert.equal(
    (
      await receiptState(
        client({
          getTransactionReceipt: async () => null,
          getTransactionCount: async () => 4,
        }),
        record,
      )
    ).kind,
    "pending",
  );
  await assert.rejects(() =>
    receiptState(
      client({
        getBlockNumber: async () => {
          throw Error("RPC offline");
        },
      }),
      record,
    ),
  );
});
test("pending transactions are isolated by wallet and network, with storage optional", () => {
  globalThis.localStorage = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
    removeItem() {
      throw Error("denied");
    },
  };
  savePending(record);
  assert.equal(pendingTransaction(46630, account).hash, hash);
  assert.equal(pendingTransaction(84532, account), null);
  assert.equal(pendingTransaction(46630, other), null);
  clearPending(record);
  assert.equal(pendingTransaction(46630, account), null);
});
test("server cache coalesces concurrent readers and falls back explicitly on outage", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { block: "10" };
  };
  const values = await Promise.all(
    Array.from({ length: 20 }, () => cached("coalesced", load, 1)),
  );
  assert.equal(calls, 1);
  assert(values.every((v) => v.block === "10"));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(
    (
      await cached(
        "coalesced",
        async () => {
          throw Error("offline");
        },
        1,
      )
    ).stale,
    true,
  );
  await assert.rejects(() =>
    cached("never-loaded", async () => {
      throw Error("offline");
    }),
  );
});
test("browser snapshot coalesces reads, keeps integer precision, distinguishes stale fallback", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v),
  };
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        ready: true,
        terms: { fee: "1000000000000000001" },
        rows: [],
        generatedAt: new Date().toISOString(),
      }),
    );
  };
  try {
    const d = { chainId: 46630, implementation: other, gateway: account };
    const snapshots = await Promise.all([marketSnapshot(d), marketSnapshot(d)]);
    assert.equal(calls, 1);
    assert.equal(snapshots[0].terms.fee, 1000000000000000001n);
    invalidateMarket();
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    assert.equal((await marketSnapshot(d)).stale, true);
    assert.equal(reviveMarket('{"name":"123","reserve":"999"}').name, "123");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
function response() {
  return {
    code: 200,
    headers: {},
    status(n) {
      this.code = n;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    json(v) {
      this.value = v;
    },
    send(v) {
      this.value = JSON.parse(v);
    },
    end() {},
  };
}
test("read APIs reject unsupported chains, malformed offsets, arbitrary curves and writes", async () => {
  for (const [handler, url, method, expected] of [
    [market, "/api/market?chain=1", "GET", 400],
    [market, "/api/market?chain=46630&offset=-1", "GET", 400],
    [market, "/api/market?chain=46630&curve=bad", "GET", 400],
    [history, "/api/history?chain=46630&curve=bad", "GET", 400],
    [market, "/api/market?chain=46630", "POST", 405],
  ]) {
    const r = response();
    await handler({ url, method }, r);
    assert.equal(r.code, expected);
  }
});
