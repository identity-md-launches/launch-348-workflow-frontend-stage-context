# Volume frontend

A single static React + TypeScript page for the deployed Sepolia VOLM / native-ETH pool. Source lives here; the ready-to-host website is `../dist/`. It uses Vite with `base: './'` and hash anchors, so it works at a gateway subpath without server rewrites. Assets and fonts require no CDN; fonts use the system stack.

The worker checkout's `.git` is read-only, so the worker could not create a Git commit. All source/export/evidence files are delivered in the working tree for the network collector to include in the submission.

## Run and rebuild

Use Node 22 and npm. From `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview
```

`npm ci` installs the exact `package-lock.json`. A clean dependency installation normally needs registry access, which this assignment permits. With the dependencies installed, compilation and export generation need no network. A cached offline lockfile installation was also checked on the worker. No registry, dependency archives, node_modules, or package caches are delivered.

`npm run dev` first builds the deployment artifacts, then starts Vite with hot reload. Its small middleware serves the same generated manifest and ABI files used in production. Re-run it after changing a deployment input. `npm run preview` serves the finished export. Production hosting needs only the contents of `dist/`.

The exporter requires the pinned commit `030e2537879f7cf474ef895f9ed1f9999fdb4830` to exist in the Git object database. It reads both ABI exports directly from that commit and verifies the existing `docs/abi/` files are byte-identical. Do not build from a source archive that omits the pinned Git history.

## Configuration and ABI binding

`config/deployment.json` and `config/network.json` are snapshots of the supplied handoff. `scripts/export.mjs` creates `dist/imd-deployment.json` **after** Vite finishes. It copies the handoff identifiers, exact deployed contract set, chain, source commit and attestation; retains the network block unchanged; copies the implementation ABI arrays; verifies their recursive-key-sorted canonical JSON Keccak hashes; and inventories every other exported file with lowercase SHA-256.

The browser reads **only that generated manifest** for addresses, chain, public RPCs, pool parameters and ABI paths. `src/config.ts` fetches the referenced ABIs and checks both their asset hashes and the deployed ABI hashes. Contract addresses/ABI arrays are not duplicated in a bundled application map. Router, StateView and Quoter interfaces are exported as local JSON assets too. The manifest is excluded from its own inventory.

This specific assignment requires PoolSwapTest (`0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`). That address is not in the supplied network block. To preserve the network block exactly and honor the explicit router requirement, the manifest has an `integrations.poolSwapTest` entry. Its sole source is the exporter. The app uses the network block's StateView, Quoter and PoolManager and verifies the router's `manager()` matches that PoolManager. The generic Universal Router / Permit2 example is not the integration requested for this assignment. No Universal Router or Permit2 approval is made.

The additional manifest fields `pool`, `deploymentBlock`, `walletAddChain` and `integrations` supply the runtime data needed by this app without a second deployment map. The exact network addition parameters are preserved. No secrets, WalletConnect project ID or private RPC endpoint are used.

## Reads and wallet behavior

Public RPCs are tried in their configured order, with an injected wallet provider as the last fallback when available. Signing always stays in the visitor's wallet. The page does not request wallet permission automatically; it only checks already-authorized accounts.

Every refresh verifies chain ID, nonempty bytecode at the deployed token/hook and used Uniswap contracts, and hook/router PoolManager bindings. The view snapshot is read at one block: epoch, end time, top five, pot, claimed/finalized flags, last four ended epochs, decimals, wallet balances, router allowance, personal volume and StateView slot0. Before the first epoch ends, there are correctly no past epochs.

The countdown advances from the block timestamp and is approximate between reads. Reads refresh every 20 seconds; data older than 60 seconds disables actions. Errors keep previously read data visibly stale. The event feed scans a maximum of 600 recent blocks, in 200-block requests, and shows at most eight matching `Credited`, `Claimed`, `EpochFinalized` events. It displays its actual block window and is not an all-history index. Contract views, not events, establish pots and rankings.

Injected EIP-1193 browser wallets are supported. If the wallet is on a different chain, a single switch control is shown. Unknown-chain errors trigger `wallet_addEthereumChain` using the handoff parameters, followed by another switch. A rejected switch does not trigger chain addition. Missing wallets, rejected requests, account changes, chain changes, disconnects, pending transactions and failed receipts have explicit states.

## Swaps and settlement

The form offers exact-input buys and sells. The Quoter's `quoteExactInputSingle` is called through `simulateContract`, never a transaction. Its [official interface](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol) defines the tuple used by the exported interface. Quotes expire in the UI after 45 seconds and changing account, direction, amount or price limit invalidates them.

Buy: pay native ETH; no token approval. Sell: first approve only the entered VOLM amount to PoolSwapTest, wait for its receipt, then get a new quote and confirm the sell. Both use a negative `amountSpecified`, `takeClaims=false`, `settleUsingBurn=false`, and exactly 32 bytes encoding the connected wallet as `hookData`. The router settles actual currencies, not ERC-6909 claims.

**PoolSwapTest has no minimum-output or deadline argument.** The form therefore calls its setting a **price movement limit**, not a guaranteed minimum output. It bounds terminal pool spot price using integer square-root math applied to the displayed snapshot; the hook rejects any partial fill. This limit includes the submitted trade's own price impact. A quote may succeed while the bounded swap simulation reverts, especially with thin liquidity; try a smaller amount or deliberately adjust the limit. Estimated receive is indicative. UI quote expiry cannot impose an on-chain transaction deadline while a wallet prompt or transaction remains pending.

All approval, swap, claim and finalize transactions are simulated before signing. Wallet account/chain are checked both before and after simulation. The UI reports submission, explorer link, receipt success/failure, and refreshes state. The wallet estimates gas; ETH for gas is additional. No real transactions were broadcast during validation.

Claims use ranks **1–5**, are available only for unpaid nonempty ranks of ended epochs, and always pay the recorded recipient. Anyone may trigger them and pays gas. `finalize` is independent of claims: it carries empty-rank shares plus rounding into the then-current pot, once per ended epoch. The page displays the ended epoch's original pot, which does not decrease after payments. Zero-value occupied ranks can still be claimed. A recipient rejecting ETH leaves that share unpaid.

## Economics and identity

VOLM is a Sepolia test toy with no value and no promised return. The pool LP fee is 0.3%; the hook separately charges 0.3% of the ETH leg on each swap. Wash volume costs both fees on every leg and only pays economically when the pot funded by others exceeds that cost. ETH and token prices here are pool ratios, not fiat prices.

The hook does **not authenticate hookData**. This page always inserts the connected account, but another caller can credit any address. The leaderboard is not a Sybil-resistant ranking. An invalid or missing identity still pays the fee but credits nobody. Ties keep incumbent priority. The frontend does not add administration, minting, pause, sweep or upgrade features to immutable contracts that have none.

## Validation

```sh
npm run test
npx playwright install chromium
npm run test:browser
npm run check:live
node tests/live-browser.mjs
```

For an isolated worker browser cache, prefix the Playwright install and browser commands with `PLAYWRIGHT_BROWSERS_PATH=/tmp/volume-playwright`. The browser scripts start and close their own preview in a bounded foreground process under `/preview/`. `tests/browser.mjs` intercepts all external RPC requests and injects a mock wallet; it never broadcasts. The separate live scripts perform public reads only. Evidence goes to `docs/frontend/`; browser binaries and dependency caches do not.

See [validation and limitations](../docs/FRONTEND_VALIDATION.md), [implemented design](../docs/DESIGN.md), and the included JSON results/screenshots. The automated suite and this worker's review are not independent network certification. Publishing source, IPFS pinning, named hosting and publication checks are subsequent control-plane work.
