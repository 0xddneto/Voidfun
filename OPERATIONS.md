# Voidfun operations

Voidfun is an independent app. Its website deploys to the existing Voidfun Vercel project. No process in this release publishes an app to a public Deed. `src/networks.json` is the sole active network manifest; gateway/runtime stay null until the owner publishes and an operator explicitly runs the read-only attachment script.

## Reads and outages

`GET /api/market?chain=ID&offset=0` returns a coherent block snapshot, at most 24 launches, and fees read from the implementation. An optional `curve=ADDRESS` loads a launch outside the current page only after confirming membership in this gateway. ETH and native USDC are never aggregated or converted into each other.

Responses are shared through Vercel CDN for 15 seconds. Per-process caches coalesce concurrent requests, bound memory to 250 entries and retain last good responses for up to 24 hours with `stale: true`. These caches are ephemeral, not a durable indexer or a guarantee that quotas can never be reached. Cold starts still read RPC. The browser polls every 30 seconds only while online and visible; a last good browser snapshot may be shown for at most seven days, explicitly marked stale. These snapshots never authorize spending. Quotes, registration, revision, account, network and simulations are checked directly before signing.

`GET /api/history?chain=ID&curve=ADDRESS` reads at most 8,000 blocks in four bounded chunks, excluding the current head. The response supplies `before` for older ranges; the UI exposes Older trades. It displays the last 60 trades in the selected range, not an assertion of full all-time history. Block hashes are checked against receipts. Refresh replaces the latest range instead of appending orphaned trades. Failed/cached history is visibly marked. No database or new paid plan is required.

Pending transactions are persisted by network and wallet. Completion requires a matching canonical block plus a subsequent block. Speed-ups with identical calldata/value are recognized; cancellations and different replacement calls cannot produce a successful purchase notification. An unresolved replacement outside the bounded 128-block search remains pending for manual review rather than encouraging duplicate spending. Confirmed reverts clear the pending record. An RPC outage does not turn into success.

## Manual publication

1. Choose a supported network and copy that network's implementation from the Voidfun website or manifest.
2. Activate the intended Deed on that network using the protocol's own interface, if required.
3. Publish through Build with the intended Deed ID, implementation, initialization `0x`, and a new salt if requested. Do not reuse an address from another network.
4. Save the transaction hash. Run `node scripts/attach-gateway.mjs --chain=ID --deed=NUMBER --tx=HASH --publisher=ADDRESS`. It verifies the factory-derived runtime, publication event, canonical receipt, code and registration without signing any transaction.
5. Review the manifest diff and redeploy only Voidfun. A gateway is independent on every network; publication on one does not activate the others.

## Deployment and recovery

Compile before deployment. Provide `VOIDFUN_DEPLOYER_KEY` only through a secure process environment. `scripts/deploy.mjs --chain=ID --trade-bps=100 --protocol-share-bps=3000 --creation-fee-wei=0 --treasury=ADDRESS` deploys three app implementations, never a Deed gateway. Each release/factory has its own ledger in deployments. Signed bytes are kept in ignored `.tools`; retries reuse the same hash. Never run two deployment processes for the same signer and network. The script stops if a pending nonce or insufficient test gas makes proceeding unsafe. Do not delete a ledger to retry an ambiguous transaction.

Run `node scripts/verify-deployment.mjs ID` to compare deployed executable code and immutable configuration. Run `node scripts/check-readiness.mjs ID` for RPC/oracle/implementation availability. Only the manifest's deploymentManifest is active; older ledgers are history. Back up the repository and current ledgers. The chain remains authoritative for launch data and balances.

GitHub Actions runs the local validation matrix. Vercel is the supported host because this release includes read APIs; GitHub Pages cannot serve them. WalletConnect requires the Voidfun Reown project ID and allowed host, and actual mobile-wallet signing still requires manual acceptance testing.

## Test boundary

`npm run compile`, `node --test tests/services.test.mjs`, `node scripts/test-networks.mjs`, `npx playwright test`, `npm run build`. Run `scripts/test.mjs` with TEST_CHAIN_ID for 46630, 11155111, 84532, 763373 and 5042002. All integration transactions run on local Anvil. They use copies of the current protocol solely as fixtures; no public Deed is modified. Local tests and code comparison are not an independent security audit or proof of perfect operation on every browser/RPC.

Each matrix run checks creation, USD reference, direct-call denial, repeat initialization, buy/sell, exact allowance, app-fee claims, separate toll accounting, ten recipients, five buy/sell cycles, slippage, expired requests, changed revisions, toll limits, foreign-factory denial, completion/refund, claims after removal, actual API reads and history. Browser tests check five-network navigation, pending-publication state, currency, mobile sizing and wallet chooser. Real user-wallet signing on public gateways remains intentionally pending manual publication.
