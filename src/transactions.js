const memory = new Map();
export const pendingKey = (chain, account) =>
  `voidfun:v2:pending:${chain}:${account.toLowerCase()}`;
export function pendingTransaction(chain, account) {
  if (!account) return null;
  const key = pendingKey(chain, account);
  try {
    const item = JSON.parse(localStorage.getItem(key) ?? "null");
    if (item) memory.set(key, item);
  } catch {
    /* Storage is optional. */
  }
  return memory.get(key) ?? null;
}
export function savePending(record) {
  const key = pendingKey(record.chainId, record.account);
  memory.set(key, record);
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    /* Keep this tab protected. */
  }
}
export function clearPending(record) {
  const key = pendingKey(record.chainId, record.account);
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}
export async function receiptState(client, record) {
  let hash = record.hash;
  let replaced = false;
  let receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  const head = await client.getBlockNumber({ cacheTime: 0 });
  if (!receipt && record.nonce !== undefined) {
    const used = await client.getTransactionCount({
      address: record.account,
      blockTag: "latest",
    });
    if (used > record.nonce) {
      const from = head > 128n ? head - 128n : 0n;
      for (let height = head; height >= from; height--) {
        const block = await client.getBlock({
          blockNumber: height,
          includeTransactions: true,
        });
        const transaction = block.transactions.find(
          (tx) =>
            typeof tx === "object" &&
            tx.from.toLowerCase() === record.account.toLowerCase() &&
            tx.nonce === record.nonce,
        );
        if (transaction) {
          hash = transaction.hash;
          replaced =
            hash.toLowerCase() !== record.hash.toLowerCase() &&
            (transaction.to?.toLowerCase() !== record.to?.toLowerCase() ||
              transaction.input !== record.data ||
              String(transaction.value) !== record.value);
          receipt = await client.getTransactionReceipt({ hash });
          break;
        }
      }
      // Never clear an unresolved nonce: it could have executed outside the search window.
    }
  }
  if (!receipt || head < receipt.blockNumber + 1n)
    return { kind: "pending", hash };
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    !block.hash ||
    block.hash !== receipt.blockHash ||
    /^0x0+$/.test(receipt.blockHash)
  )
    return { kind: "pending", hash };
  return {
    kind: replaced
      ? "replaced"
      : receipt.status === "success"
        ? "success"
        : "error",
    hash,
    receipt,
  };
}
